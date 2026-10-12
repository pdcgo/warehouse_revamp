package supplier_v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// errFoldLocked is the webhook's answer while `process_event_lock` is held. An ERROR on purpose: the push driver
// returns 500, Pub/Sub treats that as a NACK, and the event comes back after the lock is released.
var errFoldLocked = errors.New("supplier: event processing is locked (process_event_lock) — it will be redelivered")

// ErrAlreadyBackfilled is FoldBackfill's answer when the one-shot backfill has run before
// (past-accepts-are-backfilled-once). Exported so the `san` command can say so and exit cleanly.
var ErrAlreadyBackfilled = errors.New("the supplier figures were already backfilled — a second run would fold nothing")

// liveSinceLayout is the ONE encoding of `figures_live_since`: a fixed-width UTC instant, so the database's LEAST on
// the text is LEAST on the time — RFC 3339 with trimmed nanoseconds would not sort.
const liveSinceLayout = "2006-01-02T15:04:05.000000Z"

// FoldHandler is supplier_service's push handler — the fold that builds `supplier_product_daily_reports` from
// `RestockAccepted` (the-report-is-processed-like-settlement).
//
// Any other variant is ACKED: redelivering a message nothing here will ever handle is a loop, not a retry.
func (s *Service) FoldHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		accepted := event.GetRestockAccepted()
		if accepted == nil {
			return nil
		}

		_, err := s.fold(ctx, event, accepted, true)

		return err
	}
}

// BackfillResult is what one backfill did.
type BackfillResult struct {
	// Folded now.
	Folded int
	// Already folded — claimed by the live fold or an earlier attempt — or accepted after the live fold began.
	Skipped int
}

// BackfillSource walks the events to backfill, handing each to `each` — and stops at the first error `each` returns.
// A source rather than a slice, so the caller can read the accepts in batches instead of holding them all.
type BackfillSource func(each func(*eventsv1.Event) error) error

// FoldBackfill folds the RestockAccepted events the broker never carried — restocks accepted before the event existed
// (past-accepts-are-backfilled-once) — through the SAME fold the webhook runs. Built by the caller from the accepts
// themselves, with the event the accept would have sent.
//
// Two guards make it count nothing twice:
//   - an event accepted at or after `figures_live_since` is skipped — the live fold owns it, and its dedup row may be
//     pruned long before a late backfill runs;
//   - every other event is claimed in `supplier_event_logs` exactly as a live one is.
//
// It refuses outright once it has run (ErrAlreadyBackfilled). The marker is written LAST, so a run that failed half
// way is simply run again — what it folded is claimed, and skipped.
func (s *Service) FoldBackfill(ctx context.Context, source BackfillSource) (BackfillResult, error) {
	result := BackfillResult{}

	done, err := s.metadataValue(s.db.WithContext(ctx), supplier_service_models.MetadataFiguresBackfilled)
	if err != nil {
		return result, err
	}

	if done != "" {
		return result, ErrAlreadyBackfilled
	}

	liveSince, err := s.metadataValue(s.db.WithContext(ctx), supplier_service_models.MetadataFiguresLiveSince)
	if err != nil {
		return result, err
	}

	err = source(func(event *eventsv1.Event) error {
		accepted := event.GetRestockAccepted()
		if accepted == nil {
			return fmt.Errorf("backfill: %s is not a RestockAccepted", event.GetEventId())
		}

		if liveSince != "" && event.GetOccurredAt().AsTime().UTC().Format(liveSinceLayout) >= liveSince {
			result.Skipped++

			return nil
		}

		folded, err := s.fold(ctx, event, accepted, false)
		if err != nil {
			return err
		}

		if folded {
			result.Folded++
		} else {
			result.Skipped++
		}

		return nil
	})
	if err != nil {
		return result, err
	}

	err = s.db.WithContext(ctx).Exec(
		`INSERT INTO supplier_service_metadata (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
		supplier_service_models.MetadataFiguresBackfilled, time.Now().UTC().Format(time.RFC3339),
	).Error
	if err != nil {
		return result, err
	}

	return result, nil
}

// fold applies ONE accept to the figures, and reports whether it did — false when the event was already claimed, or
// names no supplier.
//
// ⚠ ONE TRANSACTION for the lock check, the dedup claim and every statement. A failure rolls the claim back with the
// figures, so the redelivery genuinely reprocesses rather than being recognised as "already done" with nothing folded.
func (s *Service) fold(
	ctx context.Context,
	event *eventsv1.Event,
	accepted *eventsv1.RestockAccepted,
	live bool,
) (bool, error) {
	// No supplier, no figures (the-supplier-comes-from-the-restock-until-lines-name-a-store). ACKED: it will never be
	// anything else.
	if accepted.GetSupplierId() == 0 {
		return false, nil
	}

	// The day is the accept's Jakarta day as inventory stated it — read, never re-derived from an instant.
	day := accepted.GetAcceptedOn()

	_, err := parseDate(day)
	if err != nil {
		return false, fmt.Errorf("supplier fold: %s has accepted_on %q: %w", event.GetEventId(), day, err)
	}

	raw, err := san_event.Marshal(event)
	if err != nil {
		return false, err
	}

	folded := false

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1 · THE MAINTENANCE LOCK, read FOR SHARE. A replay takes the row FOR UPDATE to set it, so a fold already
		// running finishes before the replay's delete begins, and a fold arriving after sees the lock.
		locked, err := readEventLock(tx.Clauses(clause.Locking{Strength: "SHARE"}))
		if err != nil {
			return err
		}

		if locked {
			return errFoldLocked
		}

		// 2 · THE CLAIM. Dedup is the write, never a predicate before it: rows affected 0 means this accept was already
		// folded, and the transaction commits having written nothing.
		claim := tx.Exec(
			`INSERT INTO supplier_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
			event.GetEventId(), raw, day,
		)
		if claim.Error != nil {
			return claim.Error
		}

		if claim.RowsAffected == 0 {
			return nil
		}

		// 3 · EVERY LINE — ONE upsert for the whole accept. The six figures are movements, so two accepts on one day
		// simply ADD, and no later day changes: there is no balance to carry.
		err = foldLines(tx, day, accepted.GetSupplierId(), accepted.GetTeamId(), accepted.GetLines())
		if err != nil {
			return err
		}

		// 4 · THE LIVE FOLD'S START — the backfill's cutoff. Lowered, never raised, by every live fold.
		if live {
			err = tx.Exec(`
INSERT INTO supplier_service_metadata (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE
SET value = LEAST(supplier_service_metadata.value, EXCLUDED.value), updated_at = NOW()
WHERE EXCLUDED.value < supplier_service_metadata.value`,
				supplier_service_models.MetadataFiguresLiveSince,
				event.GetOccurredAt().AsTime().UTC().Format(liveSinceLayout),
			).Error
			if err != nil {
				return err
			}
		}

		folded = true

		return nil
	})

	return folded, err
}

// foldLines adds every counted line of an accept to its day's rows — ONE statement, whatever the parcel's size
// (audits/services/supplier_service/performances/FoldHandler.md: it was one round trip per line). A line that counted
// nothing writes nothing.
//
//   - Each line is VALUED here, before the sum, so a line still rounds once (lineValue).
//   - GROUP BY product: one accept naming a product on two lines adds both, as the per-line loop did — and a single
//     INSERT may not touch one row twice.
//   - ⚠ ORDER BY product — the fold's ONE lock order over the day's rows. Two accepts for one day, supplier and team
//     share those rows; locked in each restock's typed order they DEADLOCK — proved, then fixed
//     (audits/services/supplier_service/concurrency/FoldHandler.md). In product order the second waits behind the first.
func foldLines(tx *gorm.DB, day string, supplierID, teamID uint64, lines []*eventsv1.RestockAcceptedLine) error {
	var products, rc, rv, lc, lv, bc, bv []int64

	for _, line := range lines {
		accepted, lost, broken := line.GetAcceptedCount(), line.GetLostCount(), line.GetBrokenCount()
		if accepted == 0 && lost == 0 && broken == 0 {
			continue
		}

		value := lineValue(line)

		products = append(products, int64(line.GetProductId()))
		rc = append(rc, accepted)
		rv = append(rv, value(accepted))
		lc = append(lc, lost)
		lv = append(lv, value(lost))
		bc = append(bc, broken)
		bv = append(bv, value(broken))
	}

	if len(products) == 0 {
		return nil
	}

	err := tx.Exec(`
INSERT INTO supplier_product_daily_reports AS d (
    day, supplier_id, product_id, team_id,
    restock_count, restock_valuation,
    shipping_lost_count, shipping_lost_valuation,
    shipping_broken_count, shipping_broken_valuation,
    last_updated
)
SELECT CAST(@day AS date), @supplier, l.product_id, @team,
       SUM(l.rc), SUM(l.rv), SUM(l.lc), SUM(l.lv), SUM(l.bc), SUM(l.bv), NOW()
FROM unnest(
    CAST(@products AS bigint[]), CAST(@rc AS bigint[]), CAST(@rv AS bigint[]),
    CAST(@lc AS bigint[]), CAST(@lv AS bigint[]), CAST(@bc AS bigint[]), CAST(@bv AS bigint[])
) AS l(product_id, rc, rv, lc, lv, bc, bv)
GROUP BY l.product_id
ORDER BY l.product_id
ON CONFLICT (day, supplier_id, product_id, team_id) DO UPDATE
SET restock_count             = d.restock_count + EXCLUDED.restock_count,
    restock_valuation         = d.restock_valuation + EXCLUDED.restock_valuation,
    shipping_lost_count       = d.shipping_lost_count + EXCLUDED.shipping_lost_count,
    shipping_lost_valuation   = d.shipping_lost_valuation + EXCLUDED.shipping_lost_valuation,
    shipping_broken_count     = d.shipping_broken_count + EXCLUDED.shipping_broken_count,
    shipping_broken_valuation = d.shipping_broken_valuation + EXCLUDED.shipping_broken_valuation,
    last_updated              = NOW()`,
		map[string]any{
			"day":      day,
			"supplier": supplierID,
			"team":     teamID,
			"products": int64Array(products),
			"rc":       int64Array(rc),
			"rv":       int64Array(rv),
			"lc":       int64Array(lc),
			"lv":       int64Array(lv),
			"bc":       int64Array(bc),
			"bv":       int64Array(bv),
		},
	).Error
	if err != nil {
		return fmt.Errorf("supplier fold: the day's rows: %w", err)
	}

	return nil
}

// lineValue values units at the line's price — total × units ÷ ordered (each-figure-is-read-at-the-accept), never
// through a rounded unit price, so a line's figures add back to what the supplier charged. A line with nothing
// ordered has no price, and its units are worth 0.
func lineValue(line *eventsv1.RestockAcceptedLine) func(units int64) int64 {
	total, ordered := line.GetTotalPrice(), line.GetOrderedCount()

	return func(units int64) int64 {
		if ordered <= 0 {
			return 0
		}

		return total * units / ordered
	}
}

// metadataValue reads one key, "" when it is not set.
func (s *Service) metadataValue(tx *gorm.DB, key string) (string, error) {
	var rows []supplier_service_models.SupplierServiceMetadata

	err := tx.Where("key = ?", key).Limit(1).Find(&rows).Error
	if err != nil {
		return "", err
	}

	if len(rows) == 0 {
		return "", nil
	}

	return rows[0].Value, nil
}

// eventLockValue is the ONE encoding of `process_event_lock`.
type eventLockValue struct {
	Lock *bool `json:"lock"`
}

var (
	lockOn  = `{"lock":true}`
	lockOff = `{"lock":false}`
)

// readEventLock reads the maintenance switch.
//
// ⚠ A MISSING OR UNPARSEABLE VALUE IS AN ERROR, never "unlocked". For a lock, failing open is the wrong direction.
func readEventLock(tx *gorm.DB) (bool, error) {
	var meta supplier_service_models.SupplierServiceMetadata

	err := tx.
		Where("key = ?", supplier_service_models.MetadataProcessEventLock).
		Take(&meta).
		Error
	if err != nil {
		return false, fmt.Errorf("supplier: cannot read %s: %w", supplier_service_models.MetadataProcessEventLock, err)
	}

	return parseEventLock(meta.Value)
}

func parseEventLock(value string) (bool, error) {
	decoded := eventLockValue{}

	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()

	err := decoder.Decode(&decoded)
	if err != nil || decoded.Lock == nil {
		return false, fmt.Errorf("supplier: %s is %q, not {\"lock\":true|false}",
			supplier_service_models.MetadataProcessEventLock, value)
	}

	return *decoded.Lock, nil
}
