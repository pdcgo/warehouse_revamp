package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// BundleDelete removes a bundle and its lines — a HARD delete, because no order refers to a bundle
// (the-order-keeps-only-product-lines). A CS may only delete a bundle she created (mayChangeBundle). The row is locked
// first, so a save of the same bundle in flight finishes before the delete, or finds it gone.
func (s *Service) BundleDelete(
	ctx context.Context,
	req *connect.Request[productv1.BundleDeleteRequest],
) (*connect.Response[productv1.BundleDeleteResponse], error) {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var bundle product_service_models.Bundle

		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", req.Msg.GetBundleId(), req.Msg.GetTeamId()).
			Take(&bundle).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return bundleNotFound()
		}
		if err != nil {
			return dbError(err)
		}

		err = mayChangeBundle(ctx, &bundle)
		if err != nil {
			return err
		}

		// The lines go with it — bundle_products.bundle_id is ON DELETE CASCADE.
		err = tx.Delete(&bundle).Error
		if err != nil {
			return dbError(err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&productv1.BundleDeleteResponse{}), nil
}
