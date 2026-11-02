package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductUnarchive brings an archived product back into the catalogue (`archived = false`) — same id, same code.
//
// It cannot collide: an archived product KEEPS its code, and the code is unique over every row, archived ones included
// (a-used-product-is-archived-never-deleted, the-field-is-product-code-composed-on-write) — so no other product can have
// taken it while it was away. Only a Delete frees a code, and only a never-used product's.
func (s *Service) ProductUnarchive(
	ctx context.Context,
	req *connect.Request[productv1.ProductUnarchiveRequest],
) (*connect.Response[productv1.ProductUnarchiveResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	var product product_service_models.Product

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Only an ARCHIVED row is restorable, and only in this team. An active id reads as NotFound
		// too: "unarchive" is meaningless for something that was never away.
		err := tx.
			Where("id = ? AND team_id = ? AND archived = ?", productID, teamID, true).
			Take(&product).
			Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errProductMissing
			}

			return err
		}

		err = tx.
			Model(&product_service_models.Product{}).
			Where("id = ? AND team_id = ?", productID, teamID).
			Updates(withUpdatedAt(map[string]any{"archived": false})).
			Error
		if err != nil {
			return err
		}

		product.Archived = false

		return nil
	})
	if err != nil {
		if errors.Is(err, errProductMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductUnarchiveResponse{
		Product: toProto(&product),
	}), nil
}
