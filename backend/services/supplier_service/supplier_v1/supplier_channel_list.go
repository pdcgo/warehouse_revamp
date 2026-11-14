package supplier_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelList pages ANY team's live supplier's live stores — the Channels tab on the My Supplier and
// the Discover Supplier detail alike (the-channels-tab-searches-filters-and-pages). `q` reads the store's
// name, link and description; `channel_type` keeps one type. A deleted or unknown supplier is NotFound.
//
// `warehouse_id` is the page's GUDANG TERKAIT chip (a-supplier-page-is-scoped-by-its-warehouses): only the stores whose
// goods were received at that warehouse — asked of inventory by the chips' own test (WarehouseGoods.StoresAtWarehouse),
// BEFORE the count and the page. The policy lets a warehouse read a store list (a restock line names its store), and
// use_scope checks team_id alone, so a warehouse role may name only its own building: where a supplier's goods went is
// the selling side's to read (SupplierGoods refuses a warehouse).
func (s *Service) SupplierChannelList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelListRequest],
) (*connect.Response[supplierv1.SupplierChannelListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()
	db := s.db.WithContext(ctx)

	warehouseID := filter.GetWarehouseId()
	if warehouseID != 0 && isWarehouseRole(san_auth.GetCallerRole(ctx)) && warehouseID != msg.GetTeamId() {
		return nil, connect.NewError(connect.CodePermissionDenied, errOtherWarehouseStores)
	}

	_, err := liveSupplier(db, filter.GetSupplierId())
	if err != nil {
		return nil, err
	}

	set, err := s.channelSetOf(ctx, filter)
	if err != nil {
		return nil, err
	}

	query := set.query(db)

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, internal(err)
	}

	var channels []supplier_service_models.SupplierChannel

	err = query.
		Order(channelOrderClause(msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&channels).
		Error
	if err != nil {
		return nil, internal(err)
	}

	items, ids := channelListItems(channels, msg.GetDataRequest())

	return connect.NewResponse(&supplierv1.SupplierChannelListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

var errOtherWarehouseStores = errors.New("a warehouse may narrow a supplier's stores only by its own building")

// channelSet is the Toko tab's set — one supplier's live stores, narrowed by the search, the type and the page's
// warehouse chip. The list and its export (SupplierChannelExport) read it, so the file holds exactly the rows the tab
// pages through.
type channelSet struct {
	filter *supplierv1.SupplierChannelListFilter
	// The stores whose goods were received at the chip's warehouse — inventory's answer, asked once. Read only when the
	// filter names a warehouse.
	atWarehouse []uint64
}

// channelSetOf builds the set; with a warehouse chip it first asks inventory which of the supplier's stores had goods
// received there.
func (s *Service) channelSetOf(ctx context.Context, filter *supplierv1.SupplierChannelListFilter) (channelSet, error) {
	set := channelSet{filter: filter}

	warehouseID := filter.GetWarehouseId()
	if warehouseID == 0 {
		return set, nil
	}

	at, ok := s.goods.(WarehouseGoods)
	if !ok {
		return set, internal(errNoWarehouseGoods)
	}

	stores, err := at.StoresAtWarehouse(ctx, filter.GetSupplierId(), warehouseID)
	if err != nil {
		return set, internal(err)
	}

	set.atWarehouse = stores

	return set, nil
}

// query is the whole set over `supplier_channels`.
func (set channelSet) query(db *gorm.DB) *gorm.DB {
	filter := set.filter
	query := db.
		Model(&supplier_service_models.SupplierChannel{}).
		Where("supplier_id = ? AND deleted_at IS NULL", filter.GetSupplierId())

	// The chip: a supplier has few stores, so the ones received there go in as one small id array — none is no store.
	if filter.GetWarehouseId() != 0 {
		if len(set.atWarehouse) == 0 {
			return query.Where("FALSE")
		}

		query = query.Where("id = ANY(CAST(? AS bigint[]))", idArray(set.atWarehouse))
	}

	if pattern := likePattern(filter.GetQ()); pattern != "" {
		query = query.Where("name ILIKE ? OR uri ILIKE ? OR description ILIKE ?", pattern, pattern, pattern)
	}

	if channelType := filter.GetChannelType(); channelType != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where("channel_type = ?", san_marketplace.ToText(channelType))
	}

	return query
}
