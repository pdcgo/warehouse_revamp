package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductDelete soft-deletes a product in the scoped team (`deleted = true`), which also frees its
// SKU for reuse. A product in another team reads as NotFound.
func (s *Service) ProductDelete(
	ctx context.Context,
	req *connect.Request[productv1.ProductDeleteRequest],
) (*connect.Response[productv1.ProductDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := productExists(tx, teamID, productID)
		if err != nil {
			return err
		}

		if !exists {
			return errProductMissing
		}

		return tx.
			Model(&product_service_models.Product{}).
			Where("id = ? AND team_id = ?", productID, teamID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		if errors.Is(err, errProductMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductDeleteResponse{}), nil
}
