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

// ProductUpdate edits a product in the scoped team. Absent scalar fields are left alone; a present
// `images` wrapper REPLACES the whole gallery (and re-denormalises the cover), while a nil wrapper
// leaves the images untouched. The team_id clause scopes the write — another team's product is
// NotFound.
//
// The team's part of the CODE may be corrected only while the product has NO HISTORY — the line ProductDelete uses
// (the-field-is-product-code-composed-on-write): once it has been in a stock movement, an order line or a restock line a
// sticker can exist, and the code is fixed (FailedPrecondition). Sending the part it already has is not a correction, so
// a form that always sends it can still save a used product's name.
func (s *Service) ProductUpdate(
	ctx context.Context,
	req *connect.Request[productv1.ProductUpdateRequest],
) (*connect.Response[productv1.ProductUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	updates := map[string]any{}

	// Composed before the transaction: the team's code is a call to team_service, and it is immutable, so nothing can
	// change it between this read and the write.
	newCode := ""

	if req.Msg.ProductCodePart != nil {
		var err error

		newCode, err = s.productCodeFor(ctx, teamID, req.Msg.GetProductCodePart())
		if err != nil {
			return nil, err
		}
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

	// Present-and-0 means "charge nothing", absent means "leave whatever it was" — two different
	// instructions that a non-optional field could not tell apart.
	if req.Msg.CrossMarkupBps != nil {
		updates["cross_markup_bps"] = req.Msg.GetCrossMarkupBps()
	}

	// The list edits this one directly, a switch per row, so it arrives on its own with nothing else
	// in the message — which is exactly why every other field has to be absent-means-untouched.
	if req.Msg.CrossLocked != nil {
		updates["cross_locked"] = req.Msg.GetCrossLocked()
	}

	// Present-and-0 means "stop holding anything back"; absent means "leave the buffer alone".
	if req.Msg.ReservedStock != nil {
		updates["reserved_stock"] = req.Msg.GetReservedStock()
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

		if newCode != "" {
			err = s.correctCode(ctx, tx, teamID, productID, newCode, updates)
			if err != nil {
				return err
			}
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
		switch {
		case errors.Is(err, errProductMissing):
			return nil, notFound()
		case errors.Is(err, errCodeFixedByHistory):
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		case errors.Is(err, errNoHistoryReader):
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductUpdateResponse{Product: toProto(&product)}), nil
}

// correctCode adds the composed code to the update when it CHANGES the product's code and the product has no history.
// The row is locked first, so a correction and a delete — or two corrections — of one product serialise, and the history
// is asked under that lock, as ProductDelete asks it.
func (s *Service) correctCode(
	ctx context.Context,
	tx *gorm.DB,
	teamID, productID uint64,
	newCode string,
	updates map[string]any,
) error {
	var current product_service_models.Product

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "product_code").
		Where("id = ? AND team_id = ?", productID, teamID).
		Take(&current).
		Error
	if err != nil {
		return err
	}

	if current.ProductCode == newCode {
		return nil
	}

	if s.history == nil {
		return errNoHistoryReader
	}

	used, err := s.history.ProductHasHistory(ctx, productID)
	if err != nil {
		return err
	}

	if used {
		return errCodeFixedByHistory
	}

	updates["product_code"] = newCode

	return nil
}
