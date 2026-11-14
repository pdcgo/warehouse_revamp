package category_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// SubtreeIDs returns a category and every category below it, at any depth — what a picked branch keeps on Discover's
// Kategori filter (a-picked-branch-keeps-its-whole-subtree): *Makanan* is Makanan, Snack and Keripik; an end category
// is itself alone. An id that is no category answers nothing. The ids come back in id order.
//
// A soft-deleted node below the pick is still walked: a product filed under it is still under the branch (a delete
// only refuses while active children remain, so a deleted node holds no active ones). UNION, not UNION ALL, so a
// parent loop could never run the walk forever.
//
// A plain function over category_service's own table (HARD RULE 3): product_service asks it through the composition
// root's seam (cmd/app_development/product_categories.go). One recursive statement over categories_parent_idx however
// deep the tree.
func SubtreeIDs(ctx context.Context, db *gorm.DB, categoryID uint64) ([]uint64, error) {
	var ids []uint64

	err := db.WithContext(ctx).Raw(`
WITH RECURSIVE tree(id) AS (
    SELECT id FROM categories WHERE id = @root
    UNION
    SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id
)
SELECT id FROM tree ORDER BY id`,
		map[string]any{"root": categoryID},
	).Scan(&ids).Error
	if err != nil {
		return nil, fmt.Errorf("category subtree of %d: %w", categoryID, err)
	}

	return ids, nil
}
