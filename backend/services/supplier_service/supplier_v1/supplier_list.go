package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
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
func (s *Service) SupplierList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierListRequest],
) (*connect.Response[supplierv1.SupplierListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()

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

	query, err := s.narrowByBand(ctx, query, GoodsSold, filter.GetSold())
	if err != nil {
		return nil, err
	}

	query, err = s.narrowByBand(ctx, query, GoodsReady, filter.GetReady())
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

// narrowByBand keeps the suppliers whose figure lies in the band, `min` inclusive and `max` exclusive.
//
// inventory can list only suppliers WITH goods, while a supplier that never sold reads 0 — so a band from 0 is asked as
// its complement: everyone EXCEPT the suppliers at or above its top. A band from above 0 is the set itself. Both go in
// as one array parameter; an empty set from above 0 is no supplier at all.
func (s *Service) narrowByBand(
	ctx context.Context,
	query *gorm.DB,
	figure GoodsFigure,
	band *supplierv1.SupplierFigureBand,
) (*gorm.DB, error) {
	if band == nil || (band.GetMin() == 0 && band.GetMax() == 0) {
		return query, nil
	}

	if band.GetMin() == 0 {
		above, err := s.goods.SupplierIDsByFigure(ctx, figure, band.GetMax(), 0)
		if err != nil {
			return nil, internal(err)
		}

		if len(above) == 0 {
			return query, nil
		}

		return query.Where("suppliers.id <> ALL(CAST(? AS bigint[]))", idArray(above)), nil
	}

	in, err := s.goods.SupplierIDsByFigure(ctx, figure, band.GetMin(), band.GetMax())
	if err != nil {
		return nil, internal(err)
	}

	if len(in) == 0 {
		return query.Where("FALSE"), nil
	}

	return query.Where("suppliers.id = ANY(CAST(? AS bigint[]))", idArray(in)), nil
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
