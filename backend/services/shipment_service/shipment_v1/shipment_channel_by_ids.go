package shipment_v1

import (
	"context"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

// ShipmentChannelByIds resolves ids a caller already holds. DELETED CHANNELS ARE RETURNED, flagged, so
// an old order never shows a blank courier (a-deleted-channel-still-resolves-by-id). An unknown id is
// absent, not an error. No paging: the caller supplies the set, capped by the contract's max_items.
func (s *Service) ShipmentChannelByIds(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelByIdsRequest],
) (*connect.Response[shipmentv1.ShipmentChannelByIdsResponse], error) {
	var channels []shipment_service_models.ShipmentChannel

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&channels).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelByIdsResponse{
		Items: byIdsMap(channels, req.Msg.GetDataRequest()),
	}), nil
}
