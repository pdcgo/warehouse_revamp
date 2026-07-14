// Package shipping_v1 implements warehouse.shipping.v1.ShippingService — the courier catalogue.
package shipping_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1/shippingv1connect"
)

// Service is the ShippingService handler. It only reads the seeded `shippings` table.
type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ shippingv1connect.ShippingServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}
