package supplier_v1

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// A SUPPLIER'S PRODUCTS — `supplier_channel_products` (00005), what the Produk tab lists: one row per product per store
// it was bought from (products-hang-off-a-channel), and per supplier with no store for a line naming the supplier alone
// (a-line-with-no-store-links-under-the-supplier). Written by the accepted restock only
// (restock-accepted-links-the-product-to-its-channel): the RestockAccepted fold, in the same transaction as the figures,
// behind the same claim; and `san supplier backfill-links` (LinkBackfill) for the accepts before the table.
//
// ⚠ ONE WRITE, upsertLinks — the fold and the backfill both go through it, so they cannot disagree on a date, and both
// lock the rows in ONE order (linkKey's), so two writers naming the same links wait instead of deadlocking.

// linkBatch is how many links one backfill transaction writes — short transactions, so a live fold naming the same
// link waits milliseconds, never the whole backfill.
const linkBatch = 500

// linkKey is one link: a supplier, its store (0 = none), a product and the product's team — the table's unique key.
type linkKey struct {
	supplierID uint64
	channelID  uint64
	productID  uint64
	teamID     uint64
}

// compareLinkKeys is THE lock order of every link write.
func compareLinkKeys(a, b linkKey) int {
	return cmp.Or(
		cmp.Compare(a.supplierID, b.supplierID),
		cmp.Compare(a.channelID, b.channelID),
		cmp.Compare(a.productID, b.productID),
		cmp.Compare(a.teamID, b.teamID),
	)
}

// linkRow is one link as a write names it: the earliest and latest accept it knows, and the latest's restock.
type linkRow struct {
	linkKey
	first     time.Time
	last      time.Time
	restockID uint64
}

// later says whether (at, restock) is a later accept than the row's latest — ties on the instant break by restock id.
func (r linkRow) later(at time.Time, restockID uint64) bool {
	return at.After(r.last) || (at.Equal(r.last) && restockID > r.restockID)
}

// linksOf is every link one accept writes — each line naming a supplier, broken and short ones included
// (every-accepted-line-links-its-own-product), once per supplier, store and product — sorted in the lock order.
func linksOf(figures restockFigures) []linkRow {
	seen := map[linkKey]bool{}
	rows := make([]linkRow, 0, len(figures.lines))

	for _, line := range figures.lines {
		key := linkKey{supplierID: line.supplierID, channelID: line.channelID, productID: line.GetProductId(), teamID: figures.teamID}
		if seen[key] {
			continue
		}

		seen[key] = true
		rows = append(rows, linkRow{linkKey: key, first: figures.at, last: figures.at, restockID: figures.restockID})
	}

	slices.SortFunc(rows, func(a, b linkRow) int { return compareLinkKeys(a.linkKey, b.linkKey) })

	return rows
}

// linkCounts is what one link write did.
type linkCounts struct {
	// Inserted is the links written new; Moved the existing ones whose dates moved — an earlier first accept or a later
	// last one. The rest were already as the write says, and were not touched.
	Inserted int
	Moved    int
}

// upsertLinks writes the rows — ONE statement, in the rows' order, which the callers sort by linkKey (the lock order).
//
//   - A new link takes the row's dates; an existing one keeps the EARLIER first accept and the LATER last one with its
//     restock (a-link-remembers-its-last-restock: GREATEST — a late or repeated event never lowers it).
//   - ⚠ The UPDATE runs only when a date moves (its WHERE): a write that changes nothing leaves the row exactly as it is,
//     `updated_at` included — what makes a backfill run twice, or a link named again by an older accept, a no-op.
//   - The store-less link's key holds a NULL channel; the unique index is NULLS NOT DISTINCT, so it conflicts like any
//     other.
func upsertLinks(tx *gorm.DB, rows []linkRow) (linkCounts, error) {
	counts := linkCounts{}

	if len(rows) == 0 {
		return counts, nil
	}

	var teams, suppliers, channels, products, firsts, lasts, restocks []int64

	for _, row := range rows {
		teams = append(teams, int64(row.teamID))
		suppliers = append(suppliers, int64(row.supplierID))
		channels = append(channels, int64(row.channelID))
		products = append(products, int64(row.productID))
		firsts = append(firsts, row.first.UnixMicro())
		lasts = append(lasts, row.last.UnixMicro())
		restocks = append(restocks, int64(row.restockID))
	}

	// Instants travel as unix MICROSECONDS — timestamptz's own precision — and come back exactly through interval
	// arithmetic (no float division).
	written := []struct {
		Inserted bool
	}{}

	err := tx.Raw(`
INSERT INTO supplier_channel_products AS l (
    team_id, supplier_id, channel_id, product_id, first_restocked_at, last_restocked_at, last_restock_id
)
SELECT k.team_id, k.supplier_id, NULLIF(k.channel_id, 0), k.product_id,
       TIMESTAMPTZ 'epoch' + k.first_us * INTERVAL '1 microsecond',
       TIMESTAMPTZ 'epoch' + k.last_us * INTERVAL '1 microsecond',
       k.restock_id
FROM unnest(
    CAST(@teams AS bigint[]), CAST(@suppliers AS bigint[]), CAST(@channels AS bigint[]), CAST(@products AS bigint[]),
    CAST(@firsts AS bigint[]), CAST(@lasts AS bigint[]), CAST(@restocks AS bigint[])
) WITH ORDINALITY AS k(team_id, supplier_id, channel_id, product_id, first_us, last_us, restock_id, ord)
ORDER BY k.ord
ON CONFLICT (supplier_id, channel_id, product_id, team_id) DO UPDATE
SET first_restocked_at = LEAST(l.first_restocked_at, EXCLUDED.first_restocked_at),
    last_restocked_at  = GREATEST(l.last_restocked_at, EXCLUDED.last_restocked_at),
    last_restock_id    = CASE WHEN (EXCLUDED.last_restocked_at, EXCLUDED.last_restock_id) > (l.last_restocked_at, l.last_restock_id)
                              THEN EXCLUDED.last_restock_id ELSE l.last_restock_id END,
    updated_at         = NOW()
WHERE (EXCLUDED.last_restocked_at, EXCLUDED.last_restock_id) > (l.last_restocked_at, l.last_restock_id)
   OR EXCLUDED.first_restocked_at < l.first_restocked_at
RETURNING (xmax = 0) AS inserted`,
		map[string]any{
			"teams":     int64Array(teams),
			"suppliers": int64Array(suppliers),
			"channels":  int64Array(channels),
			"products":  int64Array(products),
			"firsts":    int64Array(firsts),
			"lasts":     int64Array(lasts),
			"restocks":  int64Array(restocks),
		},
	).Scan(&written).Error
	if err != nil {
		return counts, fmt.Errorf("supplier links: %w", err)
	}

	for _, w := range written {
		if w.Inserted {
			counts.Inserted++
		} else {
			counts.Moved++
		}
	}

	return counts, nil
}

// SwitchedRestock is an accept whose figures the line-supplier switch changes: its lines name a supplier while the
// restock as a whole named none (a restock mixing suppliers, or naming one on some lines only), so the fold before the
// switch credited nobody (the-supplier-comes-from-the-restock-until-lines-name-a-store). Each supplier's figures on
// the accept's day — and on every day the restock's received count was corrected — are short until re-folded.
type SwitchedRestock struct {
	RestockID uint64
	Day       string
	Suppliers []uint64
}

// LinkBackfillResult is what LinkBackfill found and did.
type LinkBackfillResult struct {
	// Accepts is the accepted restocks read; Lines their lines naming a supplier — every one links; Links the distinct
	// links those lines name.
	Accepts int
	Lines   int
	Links   int
	// What the write did to those links: written new, dates moved, already as the accepts say.
	Inserted  int
	Moved     int
	Unchanged int
	// Switched is every accept the line-supplier switch changes — the caller re-folds their suppliers' days.
	Switched []SwitchedRestock
	DryRun   bool
}

// errLinkDryRun rolls a dry run's batch back after it was written.
var errLinkDryRun = errors.New("dry run")

// LinkBackfill rebuilds the links from the accepts that came before the link table — `san supplier backfill-links`.
// REPEATABLE: every write is the fold's own upsert (upsertLinks), so a second run inserts nothing and moves nothing, and
// a run beside the live fold writes the same dates the fold would.
//
// The source hands it the RestockAccepted each accept sends (inventory's builder). It reads them all first, merging every
// accept naming one link into ONE row (its earliest and latest accept), then writes linkBatch links per transaction in
// the lock order. A dry run writes each batch and rolls it back, so its counts are exactly what a real run would do.
//
// It never claims an event and never touches the figures: those are the fold's, and a switched accept's figures are
// re-folded by the caller (Switched) through DayRefold, which claims what was never folded.
func (s *Service) LinkBackfill(ctx context.Context, source BackfillSource, dryRun bool) (LinkBackfillResult, error) {
	result := LinkBackfillResult{DryRun: dryRun}
	merged := map[linkKey]*linkRow{}

	err := source(func(event *eventsv1.Event) error {
		accepted := event.GetRestockAccepted()
		if accepted == nil {
			return fmt.Errorf("link backfill: %s is not a RestockAccepted", event.GetEventId())
		}

		figures, _ := restockFiguresOf(event)
		result.Accepts++
		result.Lines += len(figures.lines)

		if accepted.GetSupplierId() == 0 && len(figures.lines) > 0 {
			result.Switched = append(result.Switched, SwitchedRestock{
				RestockID: accepted.GetRestockId(), Day: figures.day, Suppliers: figures.suppliers(),
			})
		}

		for _, row := range linksOf(figures) {
			have := merged[row.linkKey]
			if have == nil {
				copied := row
				merged[row.linkKey] = &copied

				continue
			}

			if row.first.Before(have.first) {
				have.first = row.first
			}

			if have.later(row.last, row.restockID) {
				have.last, have.restockID = row.last, row.restockID
			}
		}

		return nil
	})
	if err != nil {
		return result, err
	}

	rows := make([]linkRow, 0, len(merged))
	for _, row := range merged {
		rows = append(rows, *row)
	}

	slices.SortFunc(rows, func(a, b linkRow) int { return compareLinkKeys(a.linkKey, b.linkKey) })

	result.Links = len(rows)

	for start := 0; start < len(rows); start += linkBatch {
		batch := rows[start:min(start+linkBatch, len(rows))]

		var counts linkCounts

		err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error

			counts, err = upsertLinks(tx, batch)
			if err != nil {
				return err
			}

			if dryRun {
				return errLinkDryRun
			}

			return nil
		})
		if err != nil && !errors.Is(err, errLinkDryRun) {
			return result, err
		}

		result.Inserted += counts.Inserted
		result.Moved += counts.Moved
		result.Unchanged += len(batch) - counts.Inserted - counts.Moved
	}

	return result, nil
}
