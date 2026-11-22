package shipment_v1

import (
	"context"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

// ShipmentChannelUpdate edits name, desc and the tracking link — each written as sent, so an empty link clears it.
// There is no code to change (a-code-never-changes; the link is editable like name and desc, its 🔄). A deleted
// channel may still be corrected — its name is what old orders show, and its link is what they open.
func (s *Service) ShipmentChannelUpdate(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelUpdateRequest],
) (*connect.Response[shipmentv1.ShipmentChannelUpdateResponse], error) {
	trackingURL, err := checkTrackingURL(req.Msg.GetTrackingUrl())
	if err != nil {
		return nil, err
	}

	channel, err := s.updateReturning(ctx, req.Msg.GetChannelId(), map[string]any{
		"name":         req.Msg.GetName(),
		"desc":         req.Msg.GetDesc(),
		"tracking_url": trackingURL,
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelUpdateResponse{Channel: toProto(channel)}), nil
}
