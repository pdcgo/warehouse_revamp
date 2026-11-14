package inventory_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// MinimumCandidate is one product whose owner set a minimum (the reserve, one-lock-three-ways): the team that owns it,
// its id, and the minimum in units.
type MinimumCandidate struct {
	TeamID    uint64
	ProductID uint64
	Minimum   int64
}

// ClosedByMinimum answers which of these products their minimum closes NOW: the owner's ready stock across EVERY
// warehouse is UNDER it (a-minimum-closes-only-under-it, from exactly-the-reserve-stays-open). It is the line the order
// take draws — notAllowedLines lets another team in at `total >= reserve` — so a product holding exactly its minimum is
// open, and one with no ready stock anywhere is under any minimum of at least 1. The ids come back in id order.
//
// ONE statement however many candidates: the owners' live batches are summed once, grouped by (team, product), and
// joined to the candidates — never one probe per product (ownerTotalStocks' `(team_id, product_id) IN` shape is ~9×
// slower at a few thousand candidates; product_filters scoping probe, 664 ms vs 74 ms). It reads every warehouse: the
// rule does, whatever lens a screen holds.
//
// A plain function over inventory's own table (HARD RULE 3), not an RPC: product_service's list asks it through the
// composition root's seam (cmd/app_development/product_stock_narrower.go), and Discover's lock filter can hand it the
// candidates of many teams at once.
func ClosedByMinimum(ctx context.Context, db *gorm.DB, candidates []MinimumCandidate) ([]uint64, error) {
	if len(candidates) == 0 {
		return nil, nil
	}

	teams := make([]int64, 0, len(candidates))
	products := make([]int64, 0, len(candidates))
	minimums := make([]int64, 0, len(candidates))
	owners := make([]int64, 0, 1)
	seen := make(map[uint64]bool, 1)

	for _, c := range candidates {
		teams = append(teams, int64(c.TeamID))
		products = append(products, int64(c.ProductID))
		minimums = append(minimums, c.Minimum)

		if !seen[c.TeamID] {
			seen[c.TeamID] = true
			owners = append(owners, int64(c.TeamID))
		}
	}

	var ids []uint64

	// stock_count > 0 changes no sum — an emptied batch adds 0 — and is what lets the planner read the partial
	// batches_owner_product_idx.
	err := db.WithContext(ctx).Raw(`
WITH c AS (
    SELECT *
    FROM unnest(CAST(@teams AS bigint[]), CAST(@products AS bigint[]), CAST(@minimums AS bigint[]))
        AS c(team_id, product_id, minimum)
), t AS (
    SELECT b.team_id, b.product_id, SUM(b.stock_count) AS total
    FROM batches b
    WHERE b.stock_count > 0
      AND b.team_id = ANY(CAST(@owners AS bigint[]))
      AND b.product_id = ANY(CAST(@products AS bigint[]))
    GROUP BY b.team_id, b.product_id
)
SELECT DISTINCT c.product_id
FROM c
LEFT JOIN t ON t.team_id = c.team_id AND t.product_id = c.product_id
WHERE COALESCE(t.total, 0) < c.minimum
ORDER BY c.product_id`,
		map[string]any{
			"teams":    int64Array(teams),
			"products": int64Array(products),
			"minimums": int64Array(minimums),
			"owners":   int64Array(owners),
		},
	).Scan(&ids).Error
	if err != nil {
		return nil, fmt.Errorf("closed by minimum, %d candidate(s): %w", len(candidates), err)
	}

	return ids, nil
}
