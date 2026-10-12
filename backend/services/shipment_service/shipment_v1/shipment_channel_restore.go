package shipment_v1

import (
	"context"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

// ShipmentChannelRestore brings a deleted channel back — same id, same code
// (a-deleted-code-is-restored-not-recreated). Idempotent on a live channel.
func (s *Service) ShipmentChannelRestore(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelRestoreRequest],
) (*connect.Response[shipmentv1.ShipmentChannelRestoreResponse], error) {
	channel, err := s.updateReturning(ctx, req.Msg.GetChannelId(), map[string]any{"is_deleted": false})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelRestoreResponse{Channel: toProto(channel)}), nil
}
