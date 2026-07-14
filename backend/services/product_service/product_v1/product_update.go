package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductUpdate edits a product in the scoped team. Absent fields are left alone. The team_id
// clause scopes the write — a product in another team reads as NotFound.
func (s *Service) ProductUpdate(
	ctx context.Context,
	req *connect.Request[productv1.ProductUpdateRequest],
) (*connect.Response[productv1.ProductUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	updates := map[string]any{}

	if req.Msg.Sku != nil {
		updates["sku"] = req.Msg.GetSku()
	}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.Description != nil {
		updates["description"] = req.Msg.GetDescription()
	}

	var product product_service_models.Product

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, err := productExists(tx, teamID, productID)
		if err != nil {
			return err
		}

		if !exists {
			return errProductMissing
		}

		if len(updates) > 0 {
			err = tx.
				Model(&product_service_models.Product{}).
				Where("id = ? AND team_id = ?", productID, teamID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ? AND team_id = ?", productID, teamID).First(&product).Error
	})
	if err != nil {
		if errors.Is(err, errProductMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductUpdateResponse{Product: toProto(&product)}), nil
}
