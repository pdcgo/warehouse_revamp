package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductUpdate edits a product in the scoped team. Absent scalar fields are left alone; a present
// `images` wrapper REPLACES the whole gallery (and re-denormalises the cover), while a nil wrapper
// leaves the images untouched. The team_id clause scopes the write — another team's product is
// NotFound.
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

	if req.Msg.CategoryId != nil {
		updates["category_id"] = req.Msg.GetCategoryId()
	}

	// A present wrapper (even with zero items) means "replace the gallery with exactly these".
	replaceImages := req.Msg.Images != nil
	newImages := req.Msg.GetImages().GetItems()

	if replaceImages {
		coverURL, coverThumb := coverOf(newImages)
		updates["default_image_url"] = coverURL
		updates["default_image_thumbnail_url"] = coverThumb
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

		if replaceImages {
			// Swap the whole set: drop the old rows, insert the new ones in order.
			err = tx.
				Where("product_id = ?", productID).
				Delete(&product_service_models.ProductImage{}).
				Error
			if err != nil {
				return err
			}

			rows := modelImages(newImages)
			for i := range rows {
				rows[i].ProductID = productID
			}

			if len(rows) > 0 {
				err = tx.Create(&rows).Error
				if err != nil {
					return err
				}
			}
		}

		return tx.
			Preload("Images", func(db *gorm.DB) *gorm.DB {
				return db.Order("position ASC, id ASC")
			}).
			Where("id = ? AND team_id = ?", productID, teamID).
			First(&product).
			Error
	})
	if err != nil {
		if errors.Is(err, errProductMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductUpdateResponse{Product: toProto(&product)}), nil
}
