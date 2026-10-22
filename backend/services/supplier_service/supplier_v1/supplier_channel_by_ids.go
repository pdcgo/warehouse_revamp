package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelByIds reads stores by id — what a restock line shows beside its supplier — whoever keeps them, and
// DELETED ONES INCLUDED, marked, so the line still names its store with a deleted badge
// (a-deleted-supplier-still-shows-with-a-badge). Like SupplierByIds it is a read without `deleted_at IS NULL`: a
// purchase outlives its store record. An unknown id is absent, never an error.
func (s *Service) SupplierChannelByIds(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelByIdsRequest],
) (*connect.Response[supplierv1.SupplierChannelByIdsResponse], error) {
	var channels []supplier_service_models.SupplierChannel

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetIds()).
		Find(&channels).
		Error
	if err != nil {
		return nil, internal(err)
	}

	out := make(map[uint64]*supplierv1.SupplierChannel, len(channels))
	for i := range channels {
		out[channels[i].ID] = channelToProto(&channels[i])
	}

	return connect.NewResponse(&supplierv1.SupplierChannelByIdsResponse{Channels: out}), nil
}
