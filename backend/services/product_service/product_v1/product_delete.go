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

// ProductHistory answers whether a product was ever USED outside the catalogue — a stock movement, an order line, a
// restock line (a-used-product-is-archived-never-deleted). Inventory and the order side each answer for their own rows;
// the composition root joins them, so this service never reads another's table.
type ProductHistory interface {
	ProductHasHistory(ctx context.Context, productID uint64) (bool, error)
}

var (
	errProductHasHistory = errors.New("this product has a history — a stock movement, an order line or a restock line — so it cannot be deleted: archive it instead")
	// ⚠ my build detail: a bundle line holds the product by a foreign key, so a delete would fail in the database, or
	// leave a line naming nothing. Taking it out of the bundle is the bundle owner's choice, never a side effect.
	errProductInABundle = errors.New("a bundle still names this product — take it out of the bundle, or archive the product instead")
	errNoHistoryReader  = errors.New("product history cannot be read — nothing is deleted without it")
)

// ProductDelete removes a product with NO HISTORY — a typo, a duplicate — for good: its row, and its images with it
// (ON DELETE CASCADE). Its code is free again. It strands nothing, because nothing ever pointed at it.
//
// A product with history is REFUSED (FailedPrecondition), the refusal pointing at Archive — which needs no guard, since
// it can be undone. The history is asked at the moment of the delete, under the product row's lock.
func (s *Service) ProductDelete(
	ctx context.Context,
	req *connect.Request[productv1.ProductDeleteRequest],
) (*connect.Response[productv1.ProductDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	if s.history == nil {
		return nil, connect.NewError(connect.CodeInternal, errNoHistoryReader)
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var product product_service_models.Product

		// The scope check, and the lock: two deletes, or a delete and an edit, of one product at once serialise here.
		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", productID, teamID).
			Take(&product).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errProductMissing
		}

		if err != nil {
			return err
		}

		used, err := s.history.ProductHasHistory(ctx, productID)
		if err != nil {
			return err
		}

		if used {
			return errProductHasHistory
		}

		var bundled int64

		err = tx.Table("bundle_products").Where("product_id = ?", productID).Count(&bundled).Error
		if err != nil {
			return err
		}

		if bundled > 0 {
			return errProductInABundle
		}

		return tx.Delete(&product_service_models.Product{}, productID).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errProductMissing):
			return nil, notFound()
		case errors.Is(err, errProductHasHistory), errors.Is(err, errProductInABundle):
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		default:
			return nil, dbError(err)
		}
	}

	return connect.NewResponse(&productv1.ProductDeleteResponse{}), nil
}
