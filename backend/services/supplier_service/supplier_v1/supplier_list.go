package supplier_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierList pages live suppliers — the caller's team's (OWN, My Supplier) or every team's (EVERY_TEAM,
// Discover Supplier — discover-searches-every-teams-suppliers). `q` reads the supplier's name, address and
// contact AND its live stores' names; `channel_type` keeps suppliers with at least one live store of that
// type; `owner_team_id` keeps the suppliers one team keeps (discover-filters-by-the-team-that-keeps-it). The CHANNELS
// slice brings each supplier's live stores along, for Discover's badges.
//
// `sold` and `ready` are the RANGE PILLS (the-range-pills-are-a-fixed-set): Terjual and Siap as inventory reads them,
// over every team's goods, asked through GoodsReader BEFORE the count and the page — so a supplier on page 2 is found,
// and the pages count only the suppliers in the band.
//
// `warehouse_id` is the GUDANG filter (the-warehouse-filters-before-the-team): only the suppliers whose goods were
// received at that warehouse — the set the supplier page's Gudang terkait chips list — asked of inventory the same way,
// before the count and the page. Only the rows narrow: Terjual, Siap and the bands stay the supplier's whole
// (the-warehouse-filter-narrows-only-the-rows). With a warehouse picked the bands are folded into its set IN GO, so the
// statements bind ONE id array, never two. A warehouse role may name only its own building — the chips are the selling
// side's (SupplierGoods refuses a warehouse), and use_scope checks team_id alone.
func (s *Service) SupplierList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierListRequest],
) (*connect.Response[supplierv1.SupplierListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()

	warehouseID := filter.GetWarehouseId()
	if warehouseID != 0 && isWarehouseRole(san_auth.GetCallerRole(ctx)) && warehouseID != msg.GetTeamId() {
		return nil, connect.NewError(connect.CodePermissionDenied, errOtherWarehouse)
	}

	query := s.db.
		WithContext(ctx).
		Model(&supplier_service_models.Supplier{}).
		Where("suppliers.deleted_at IS NULL")

	if filter.GetScope() != supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM {
		query = query.Where("suppliers.team_id = ?", msg.GetTeamId())
	}

	// Under OWN this can only narrow to nothing or to the same set — the two conditions are simply ANDed.
	if ownerTeamID := filter.GetOwnerTeamId(); ownerTeamID != 0 {
		query = query.Where("suppliers.team_id = ?", ownerTeamID)
	}

	if pattern := likePattern(filter.GetQ()); pattern != "" {
		query = query.Where(
			"suppliers.name ILIKE ? OR suppliers.address ILIKE ? OR suppliers.contact ILIKE ? OR EXISTS ("+
				"SELECT 1 FROM supplier_channels c "+
				"WHERE c.supplier_id = suppliers.id AND c.deleted_at IS NULL AND c.name ILIKE ?)",
			pattern, pattern, pattern, pattern,
		)
	}

	if channelType := filter.GetChannelType(); channelType != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where(
			"EXISTS (SELECT 1 FROM supplier_channels c "+
				"WHERE c.supplier_id = suppliers.id AND c.deleted_at IS NULL AND c.channel_type = ?)",
			san_marketplace.ToText(channelType),
		)
	}

	query, err := s.narrowByGoods(ctx, query, warehouseID, filter.GetSold(), filter.GetReady())
	if err != nil {
		return nil, err
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, internal(err)
	}

	var suppliers []supplier_service_models.Supplier

	err = query.
		Order(supplierOrderClause(msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&suppliers).
		Error
	if err != nil {
		return nil, internal(err)
	}

	types := msg.GetDataRequest()
	if len(types) == 0 {
		types = []supplierv1.SupplierListDataType{supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER}
	}

	ids := make([]uint64, 0, len(suppliers))
	for i := range suppliers {
		ids = append(ids, suppliers[i].ID)
	}

	var channels map[uint64][]supplier_service_models.SupplierChannel

	if wantsChannels(types) && len(ids) > 0 {
		channels, err = s.liveChannelsOf(ctx, ids)
		if err != nil {
			return nil, internal(err)
		}
	}

	return connect.NewResponse(&supplierv1.SupplierListResponse{
		Items:    supplierListItems(suppliers, channels, types),
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

var errOtherWarehouse = errors.New("a warehouse may filter the suppliers only by its own building")

func isWarehouseRole(role role_basev1.Role) bool {
	switch role {
	case role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF:
		return true
	}

	return false
}

// narrowByGoods applies the filters inventory answers — the warehouse and the two bands — before the count and the page.
//
// No warehouse: each band narrows on its own (narrowByBand). A warehouse: its suppliers are the candidates, each band
// cuts them down in Go, and what is left goes in as ONE array — none left is no supplier, and a band is not even asked
// once nobody is left.
func (s *Service) narrowByGoods(
	ctx context.Context,
	query *gorm.DB,
	warehouseID uint64,
	sold, ready *supplierv1.SupplierFigureBand,
) (*gorm.DB, error) {
	if warehouseID == 0 {
		bySold, err := s.narrowByBand(ctx, query, GoodsSold, sold)
		if err != nil {
			return nil, err
		}

		return s.narrowByBand(ctx, bySold, GoodsReady, ready)
	}

	at, ok := s.goods.(WarehouseGoods)
	if !ok {
		return nil, internal(errNoWarehouseGoods)
	}

	kept, err := at.SupplierIDsAtWarehouse(ctx, warehouseID)
	if err != nil {
		return nil, internal(err)
	}

	for _, b := range []struct {
		figure GoodsFigure
		band   *supplierv1.SupplierFigureBand
	}{{GoodsSold, sold}, {GoodsReady, ready}} {
		if len(kept) == 0 {
			break
		}

		var set bandSet

		set, err = s.bandSetOf(ctx, b.figure, b.band)
		if err != nil {
			return nil, err
		}

		kept = set.cut(kept)
	}

	if len(kept) == 0 {
		return query.Where("FALSE"), nil
	}

	return query.Where("suppliers.id = ANY(CAST(? AS bigint[]))", idArray(kept)), nil
}

// bandSet is inventory's answer for one band. inventory can list only suppliers WITH goods, while a supplier that never
// sold reads 0 — so a band from 0 is asked as its complement: `ids` are the suppliers at or above its top, whom it
// keeps OUT. A band from above 0 is the set itself. `all` = no band picked.
type bandSet struct {
	all        bool
	complement bool
	ids        []uint64
}

func (s *Service) bandSetOf(ctx context.Context, figure GoodsFigure, band *supplierv1.SupplierFigureBand) (bandSet, error) {
	if band == nil || (band.GetMin() == 0 && band.GetMax() == 0) {
		return bandSet{all: true}, nil
	}

	if band.GetMin() == 0 {
		above, err := s.goods.SupplierIDsByFigure(ctx, figure, band.GetMax(), 0)
		if err != nil {
			return bandSet{}, internal(err)
		}

		return bandSet{complement: true, ids: above}, nil
	}

	in, err := s.goods.SupplierIDsByFigure(ctx, figure, band.GetMin(), band.GetMax())
	if err != nil {
		return bandSet{}, internal(err)
	}

	return bandSet{ids: in}, nil
}

// cut keeps the candidates the band keeps: those listed, or — for a complement — those not listed.
func (b bandSet) cut(candidates []uint64) []uint64 {
	if b.all {
		return candidates
	}

	listed := make(map[uint64]bool, len(b.ids))
	for _, id := range b.ids {
		listed[id] = true
	}

	keep := make([]uint64, 0, len(candidates))

	for _, id := range candidates {
		if listed[id] == b.complement {
			continue
		}

		keep = append(keep, id)
	}

	return keep
}

// narrowByBand keeps the suppliers whose figure lies in the band, `min` inclusive and `max` exclusive — as one array
// parameter: everyone EXCEPT the listed for a band from 0, the listed otherwise; an empty set from above 0 is no
// supplier.
func (s *Service) narrowByBand(
	ctx context.Context,
	query *gorm.DB,
	figure GoodsFigure,
	band *supplierv1.SupplierFigureBand,
) (*gorm.DB, error) {
	set, err := s.bandSetOf(ctx, figure, band)
	if err != nil {
		return nil, err
	}

	switch {
	case set.all, set.complement && len(set.ids) == 0:
		return query, nil
	case set.complement:
		return query.Where("suppliers.id <> ALL(CAST(? AS bigint[]))", idArray(set.ids)), nil
	case len(set.ids) == 0:
		return query.Where("FALSE"), nil
	}

	return query.Where("suppliers.id = ANY(CAST(? AS bigint[]))", idArray(set.ids)), nil
}

// idArray is int64Array over ids.
func idArray(ids []uint64) string {
	values := make([]int64, 0, len(ids))
	for _, id := range ids {
		values = append(values, int64(id))
	}

	return int64Array(values)
}

func wantsChannels(types []supplierv1.SupplierListDataType) bool {
	for _, t := range types {
		if t == supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS {
			return true
		}
	}

	return false
}

// liveChannelsOf reads one page's live stores in ONE query, oldest first — never a query per supplier.
func (s *Service) liveChannelsOf(
	ctx context.Context,
	supplierIDs []uint64,
) (map[uint64][]supplier_service_models.SupplierChannel, error) {
	var rows []supplier_service_models.SupplierChannel

	err := s.db.
		WithContext(ctx).
		Where("supplier_id IN ? AND deleted_at IS NULL", supplierIDs).
		Order("supplier_id, id").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64][]supplier_service_models.SupplierChannel, len(supplierIDs))
	for i := range rows {
		out[rows[i].SupplierID] = append(out[rows[i].SupplierID], rows[i])
	}

	return out, nil
}
