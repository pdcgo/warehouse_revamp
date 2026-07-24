package shipping_v1

import (
	"context"

	"connectrpc.com/connect"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

// ShippingCreate adds a courier to the global catalogue. `code` is the stable machine key and is
// unique — a duplicate is AlreadyExists. A new courier is active by default.
func (s *Service) ShippingCreate(
	ctx context.Context,
	req *connect.Request[shippingv1.ShippingCreateRequest],
) (*connect.Response[shippingv1.ShippingCreateResponse], error) {
	shipping := &shipping_service_models.Shipping{
		Code:   req.Msg.GetCode(),
		Name:   req.Msg.GetName(),
		Active: true,
	}

	err := s.db.WithContext(ctx).Create(shipping).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&shippingv1.ShippingCreateResponse{Shipping: toProto(shipping)}), nil
}
