package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelList pages ANY team's live supplier's live stores — the Channels tab on the My Supplier and
// the Discover Supplier detail alike (the-channels-tab-searches-filters-and-pages). `q` reads the store's
// name, link and description; `channel_type` keeps one type. A deleted or unknown supplier is NotFound.
func (s *Service) SupplierChannelList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelListRequest],
) (*connect.Response[supplierv1.SupplierChannelListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()
	db := s.db.WithContext(ctx)

	_, err := liveSupplier(db, filter.GetSupplierId())
	if err != nil {
		return nil, err
	}

	query := db.
		Model(&supplier_service_models.SupplierChannel{}).
		Where("supplier_id = ? AND deleted_at IS NULL", filter.GetSupplierId())

	if pattern := likePattern(filter.GetQ()); pattern != "" {
		query = query.Where("name ILIKE ? OR uri ILIKE ? OR description ILIKE ?", pattern, pattern, pattern)
	}

	if channelType := filter.GetChannelType(); channelType != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where("channel_type = ?", san_marketplace.ToText(channelType))
	}

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
