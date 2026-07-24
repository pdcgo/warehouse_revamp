// Package shipping_v1 implements warehouse.shipping.v1.ShippingService — the courier catalogue.
//
// Shippings are GLOBAL reference data: every authenticated user reads them, and root/admin curate
// them (the ACL is enforced by the access interceptor from the proto policy, so the handlers carry
// no auth logic). A courier is never hard-deleted — retiring one is `active = false`, so historical
// shipments keep their reference.
package shipping_v1

import (
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1/shippingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

// Service is the ShippingService handler over the seeded `shippings` table.
type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ shippingv1connect.ShippingServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

var errShippingMissing = errors.New("shipping channel not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errShippingMissing)
}

// dbError maps a duplicate code to AlreadyExists (a client error) and everything else to Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a shipping channel with this code already exists"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// shippingExists reports whether a shipping row with this id exists. A courier is never deleted, so
// there is no active/deleted filter here — an inactive courier still exists and is editable.
func shippingExists(tx *gorm.DB, id uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&shipping_service_models.Shipping{}).
		Where("id = ?", id).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}
