package inventory_ledgers

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackKey names one rack row: a product on a placement.
type RackKey struct {
	ProductID   uint64
	PlacementID uint64
}

// RackRowToEnsure is a rack row a mutation needs, created at 0 for the given owner if it does not exist yet — a move's
// destination, a sample's or a count's rack.
type RackRowToEnsure struct {
	RackKey
	TeamID uint64
}

// EnsureAndLockRacks creates every missing row at 0 in ONE insert that tolerates a concurrent one (ledger template
// Critique 4), then locks ALL the rows in ONE statement in id order (batches-lock-before-shelves-by-id). Only then may a
// mutation read their counts and change them. The rows are inserted in (product, rack) order, so two callers creating
// the same new rows queue on the first instead of each holding one the other needs. Rows of another warehouse are
// refused.
func EnsureAndLockRacks(
	tx *gorm.DB,
	warehouseID uint64,
	rows []RackRowToEnsure,
) (map[RackKey]*inventory_service_models.ProductPlacement, error) {
	if len(rows) == 0 {
		return map[RackKey]*inventory_service_models.ProductPlacement{}, nil
	}

	teamOf := make(map[RackKey]uint64, len(rows))
	keys := make([]RackKey, 0, len(rows))

	for _, r := range rows {
		if _, seen := teamOf[r.RackKey]; seen {
			continue
		}

		teamOf[r.RackKey] = r.TeamID
		keys = append(keys, r.RackKey)
	}

	sortRackKeys(keys)

	teams := make([]int64, 0, len(keys))
	products := make([]int64, 0, len(keys))
	placements := make([]int64, 0, len(keys))
	pairs := make([][]any, 0, len(keys))

	for _, k := range keys {
		teams = append(teams, int64(teamOf[k]))
		products = append(products, int64(k.ProductID))
		placements = append(placements, int64(k.PlacementID))
		pairs = append(pairs, []any{k.ProductID, k.PlacementID})
	}

	err := tx.Exec(`
		INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		SELECT v.team_id, ?, v.product_id, v.placement_id, 0
		FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[]), CAST(? AS bigint[])) WITH ORDINALITY
		     AS v(team_id, product_id, placement_id, n)
		ORDER BY v.n
		ON CONFLICT (product_id, placement_id) DO NOTHING`,
		warehouseID, int64Array(teams), int64Array(products), int64Array(placements),
	).Error
	if err != nil {
		return nil, fmt.Errorf("rack rows for %d product(s): %w", len(keys), err)
	}

	var locked []inventory_service_models.ProductPlacement

	err = tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("(product_id, placement_id) IN ?", pairs).
		Order("id").
		Find(&locked).Error
	if err != nil {
		return nil, fmt.Errorf("lock rack rows: %w", err)
	}

	out := make(map[RackKey]*inventory_service_models.ProductPlacement, len(locked))

	for i := range locked {
		row := &locked[i]
		if row.WarehouseID != warehouseID {
			return nil, fmt.Errorf("rack %d is not in warehouse %d", row.PlacementID, warehouseID)
		}

		out[RackKey{row.ProductID, row.PlacementID}] = row
	}

	return out, nil
}
