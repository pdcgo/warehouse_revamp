package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierChannelList returns the channels of ONE supplier, newest first, paginated. The supplier
// must be an active supplier in the scoped team (else NotFound) — that verification is the scope
// check; the channel query itself is by supplier_id.
func (s *Service) SupplierChannelList(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierChannelListRequest],
) (*connect.Response[inventoryv1.SupplierChannelListResponse], error) {
	teamID := req.Msg.GetTeamId()
	supplierID := req.Msg.GetSupplierId()
	page := req.Msg.GetPage()

	exists, err := supplierExists(s.db.WithContext(ctx), teamID, supplierID)
	if err != nil {
		return nil, channelErr(err)
	}
	if !exists {
		return nil, supplierNotFound()
	}

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.SupplierChannel{}).
		Where("supplier_id = ?", supplierID)

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, channelErr(err)
	}

	var channels []inventory_service_models.SupplierChannel

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&channels).
		Error
	if err != nil {
		return nil, channelErr(err)
	}

	out := make([]*inventoryv1.SupplierChannel, 0, len(channels))
	for i := range channels {
		out = append(out, supplierChannelToProto(&channels[i]))
	}

	return connect.NewResponse(&inventoryv1.SupplierChannelListResponse{
		Channels: out,
		PageInfo: pageInfo(page, total),
	}), nil
}
