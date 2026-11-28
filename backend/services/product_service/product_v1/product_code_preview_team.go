package product_v1

import (
	"context"
	"fmt"
	"slices"

	"gorm.io/gorm"
)

// TeamRecomposePreview is what RecomposeTeamCodes WOULD do to a team's products — the figures of the confirm a team code
// edit opens before anything is sent (backlog #150, the-team-code-and-product-tags-prototype-is-accepted, *the confirm*).
type TeamRecomposePreview struct {
	// Products is how many products would take the new code — every one under `<old code>-`, archived too (the write's
	// rule).
	Products int
	// ExampleOld → ExampleNew is one of them, an active product first (the lowest id among the active ones, else among
	// the archived): SL-03-ANG-001 → ANGR-ANG-001. Both empty when no product would move.
	ExampleOld string
	ExampleNew string
	// WarehouseIDs are the warehouses holding units of those products on a shelf NOW — each would have to reprint, and its
	// products would carry `need_reprint_code` until it does. Sorted; a product with nothing on a shelf adds none.
	WarehouseIDs []uint64
}

// PreviewTeamRecompose answers what a team code change from `oldCode` to `newCode` would do to the team's products, on
// the caller's db (no transaction, no lock — it writes nothing): team_service's TeamCodePreview, through the #149 seam
// (cmd/app_development/product_code_recomposer.go). The same products RecomposeTeamCodes moves (`starts_with(code,
// '<old>-')`), and the shelves the same seam reads there (StockSitsAmong). Three statements whatever the team's size:
// the example, the ids, the shelves.
func (s *Service) PreviewTeamRecompose(ctx context.Context, db *gorm.DB, teamID uint64, oldCode, newCode string) (TeamRecomposePreview, error) {
	var preview TeamRecomposePreview

	if oldCode == "" || newCode == "" || oldCode == newCode {
		return preview, fmt.Errorf("preview team %d: from %q to %q is no change", teamID, oldCode, newCode)
	}

	if s.stock == nil {
		return preview, errNoStockForReprint
	}

	read := db.WithContext(ctx)

	oldPrefix := oldCode + productCodeSeparator
	newPrefix := newCode + productCodeSeparator

	// The example: an active product first, then the lowest id — the confirm's "SL-03-ANG-001 becomes ANGR-ANG-001".
	var example []string

	err := read.
		Raw(`SELECT product_code FROM products
			WHERE team_id = ? AND starts_with(product_code, ?)
			ORDER BY archived, id
			LIMIT 1`, teamID, oldPrefix).
		Scan(&example).
		Error
	if err != nil {
		return preview, err
	}

	if len(example) == 0 {
		return preview, nil
	}

	preview.ExampleOld = example[0]
	preview.ExampleNew = newPrefix + example[0][len(oldPrefix):]

	var ids []uint64

	err = read.
		Raw("SELECT id FROM products WHERE team_id = ? AND starts_with(product_code, ?)", teamID, oldPrefix).
		Scan(&ids).
		Error
	if err != nil {
		return preview, err
	}

	preview.Products = len(ids)

	shelves, err := s.stock.StockSitsAmong(ctx, read, ids)
	if err != nil {
		return preview, fmt.Errorf("read the shelves: %w", err)
	}

	for _, shelf := range shelves {
		if !slices.Contains(preview.WarehouseIDs, shelf.WarehouseID) {
			preview.WarehouseIDs = append(preview.WarehouseIDs, shelf.WarehouseID)
		}
	}

	slices.Sort(preview.WarehouseIDs)

	return preview, nil
}
