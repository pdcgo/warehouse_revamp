package inventory_v1

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ProductIDsAgedSince answers the product list's Umur stok filter: the team's products whose OLDEST batch still holding
// ready units arrived at or before `arrivedBy` — in one warehouse, or across every warehouse when warehouseID is 0
// (the-dates-read-as-ages: "scoped by the warehouse lens"). The ids come back in id order.
//
// It is the same oldest batch the list's Umur stok column reads (ownerReadyRows: MIN(created_at) of the team's batches
// with stock_count > 0), so a filter and the column it filters never disagree. An emptied batch is not stock — dating
// the age from it would date goods that left months ago — and a product with nothing on a shelf has no age at all, so
// it never comes back. "The oldest ready batch arrived by the cutoff" is "some ready batch arrived by it", which is how
// it is asked: the rows past the cutoff are dropped before anything is grouped.
//
// The caller turns whole days into the cutoff (now − days × 24 h — the screen's daysAgo floors elapsed 24 h periods).
// A plain function over inventory's own table (HARD RULE 3), asked through the composition root's seam.
func ProductIDsAgedSince(ctx context.Context, db *gorm.DB, teamID, warehouseID uint64, arrivedBy time.Time) ([]uint64, error) {
	query := db.
		WithContext(ctx).
		Table("batches").
		Where("team_id = ?", teamID).
		Where("stock_count > 0").
		Where("created_at <= ?", arrivedBy)

	if warehouseID > 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	var ids []uint64

	err := query.
		Distinct("product_id").
		Order("product_id").
		Pluck("product_id", &ids).
		Error
	if err != nil {
		return nil, fmt.Errorf("products aged since %s, team %d: %w", arrivedBy.Format(time.RFC3339), teamID, err)
	}

	return ids, nil
}
