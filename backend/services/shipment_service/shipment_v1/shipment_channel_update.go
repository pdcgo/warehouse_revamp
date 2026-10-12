package shipment_v1

import (
	"context"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

// ShipmentChannelUpdate edits name and desc. There is no code to change (a-code-never-changes). A
// deleted channel may still be corrected — its name is what old orders show.
func (s *Service) ShipmentChannelUpdate(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelUpdateRequest],
) (*connect.Response[shipmentv1.ShipmentChannelUpdateResponse], error) {
	channel, err := s.updateReturning(ctx, req.Msg.GetChannelId(), map[string]any{
		"name": req.Msg.GetName(),
		"desc": req.Msg.GetDesc(),
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelUpdateResponse{Channel: toProto(channel)}), nil
}
