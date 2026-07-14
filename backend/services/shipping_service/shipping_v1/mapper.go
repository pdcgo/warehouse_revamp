package shipping_v1

import (
	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

func toProto(s *shipping_service_models.Shipping) *shippingv1.Shipping {
	return &shippingv1.Shipping{
		Id:     s.ID,
		Code:   s.Code,
		Name:   s.Name,
		Active: s.Active,
	}
}
