package product_v1

import (
	"context"
	"fmt"
	"slices"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// readableByIds is which of the asked products the scoped team may read the OWNER'S facts of — its tags (ProductTagsByIds)
// and its codes, former ones included (ProductCodesByIds) — by the one rule both share (products-have-their-own-tag-list,
// its 🔄 *who sees*; a-team-code-change-recomposes-its-product-codes, Q1 "A"):
//
//   - the team's OWN products — the owner reads them wherever it stands;
//   - for a WAREHOUSE, the products it has held — every product with a batch there, at 0 too, the very set its Products
//     list shows (a-warehouses-products-is-what-it-holds). Inventory knows it; it is asked in-process through the
//     StockNarrower seam (HeldAmong, over inventory's own batches — HARD RULE 3), only for the ids the team does not own.
//
// Any other id — another team's product a Discover page names, an unknown id — is left out, never refused. With no stock
// seam (a test's nil) a warehouse reads none: the answer never reaches past what can be proven. `ids` must be sorted and
// free of repeats; the answer is the team's own first, then the held ones.
func (s *Service) readableByIds(ctx context.Context, db *gorm.DB, teamID uint64, ids []uint64) ([]uint64, error) {
	var own []uint64

	err := db.
		Model(&product_service_models.Product{}).
		Where("id = ANY(CAST(? AS bigint[])) AND team_id = ?", idArray(ids), teamID).
		Pluck("id", &own).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	visible := own

	others := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if !slices.Contains(own, id) {
			others = append(others, id)
		}
	}

	if len(others) > 0 && s.stock != nil {
		held, heldErr := s.stock.HeldAmong(ctx, teamID, others)
		if heldErr != nil {
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ask which products this warehouse holds: %w", heldErr))
		}

		// Only what was asked: the seam answers among `others`, and the answer is held to it all the same.
		for _, id := range held {
			if slices.Contains(others, id) {
				visible = append(visible, id)
			}
		}
	}

	return visible, nil
}
