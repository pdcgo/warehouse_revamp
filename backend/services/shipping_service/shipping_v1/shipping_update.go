package shipping_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

// ShippingUpdate edits a courier. Absent fields are left alone. `code` is immutable, so only `name`
// and `active` can change — deactivating a courier is `active = false` (reversible; the row is
// never deleted). Unknown id is NotFound.
func (s *Service) ShippingUpdate(
	ctx context.Context,
	req *connect.Request[shippingv1.ShippingUpdateRequest],
) (*connect.Response[shippingv1.ShippingUpdateResponse], error) {
	shippingID := req.Msg.GetShippingId()

	updates := map[string]any{}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.Active != nil {
		updates["active"] = req.Msg.GetActive()
	}

	var shipping shipping_service_models.Shipping

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, err := shippingExists(tx, shippingID)
		if err != nil {
			return err
		}

		if !exists {
			return errShippingMissing
		}

		if len(updates) > 0 {
			err = tx.
				Model(&shipping_service_models.Shipping{}).
				Where("id = ?", shippingID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ?", shippingID).First(&shipping).Error
	})
	if err != nil {
		if errors.Is(err, errShippingMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&shippingv1.ShippingUpdateResponse{Shipping: toProto(&shipping)}), nil
}
