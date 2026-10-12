package product_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// errSkuTaken is the one failure that is specific to restoring: the SKU the product was archived
// under now belongs to an active product, so bringing it back would break the partial uniqueness
// index — and, more to the point, would leave two live products answering to one SKU.
var errSkuTaken = errors.New("sku taken")

// ProductRestore brings an archived product back into the catalogue (`deleted = false`).
//
// The SKU is the whole difficulty. Archiving frees it (the index is
// `(team_id, sku) WHERE deleted = FALSE`), so somebody may have re-used it in the meantime. When that
// has happened the restore is REFUSED and the conflicting product is named, rather than silently
// renaming either row: a SKU is how a person finds a box on a shelf. A caller that wants to go ahead
// anyway supplies a new `sku` and the restore lands under that.
func (s *Service) ProductRestore(
	ctx context.Context,
	req *connect.Request[productv1.ProductRestoreRequest],
) (*connect.Response[productv1.ProductRestoreResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	var product product_service_models.Product

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Only an ARCHIVED row is restorable, and only in this team. An active id reads as NotFound
		// too: "restore" is meaningless for something that was never away.
		err := tx.
			Where("id = ? AND team_id = ? AND deleted = ?", productID, teamID, true).
			Take(&product).
			Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errProductMissing
			}

			return err
		}

		sku := product.SKU

		newSKU := strings.TrimSpace(req.Msg.GetSku())
		if newSKU != "" {
			sku = newSKU
		}

		var holder product_service_models.Product

		err = tx.
			Where("team_id = ? AND sku = ? AND deleted = ?", teamID, sku, false).
			Take(&holder).
			Error

		switch {
		case err == nil:
			return fmt.Errorf("%w: %q is held by %q", errSkuTaken, sku, holder.Name)
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return err
		}

		updates := map[string]any{"deleted": false, "sku": sku}

		err = tx.
			Model(&product_service_models.Product{}).
			Where("id = ? AND team_id = ?", productID, teamID).
			Updates(withUpdatedAt(updates)).
			Error
		if err != nil {
			return err
		}

		product.SKU = sku
		product.Deleted = false

		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errProductMissing):
			return nil, notFound()
		case errors.Is(err, errSkuTaken):
			// AlreadyExists, matching what a duplicate SKU returns everywhere else — the caller's fix
			// is the same one (choose another SKU), and the message names who has it.
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductRestoreResponse{
		Product: toProto(&product),
	}), nil
}
