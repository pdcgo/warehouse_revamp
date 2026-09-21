package shipment_v1

import (
	"context"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

// ShipmentChannelDelete soft-deletes a channel (a-channel-is-soft-deleted). Idempotent: deleting a
// deleted channel leaves it deleted.
func (s *Service) ShipmentChannelDelete(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelDeleteRequest],
) (*connect.Response[shipmentv1.ShipmentChannelDeleteResponse], error) {
	channel, err := s.updateReturning(ctx, req.Msg.GetChannelId(), map[string]any{"is_deleted": true})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelDeleteResponse{Channel: toProto(channel)}), nil
}
