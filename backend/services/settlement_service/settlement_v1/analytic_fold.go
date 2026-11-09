package settlement_v1

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
)

// errFoldLocked is the webhook's answer while `process_event_lock` is held. It is an ERROR on purpose:
// the push driver returns 500, Pub/Sub treats that as a NACK, and the event comes back after the lock is
// released (analytic_context.md §Flow — "return 500 error with event process locked").
var errFoldLocked = errors.New("settlement: event processing is locked (process_event_lock) — it will be redelivered")

// FoldHandler is settlement's push handler — the fold that builds every report table from
// `SettlementLogPosted` (#the-fold-owns-the-report-not-the-writer).
//
// Any other variant is ACKED: redelivering a message nothing here will ever handle is a loop, not a retry.
func (s *Service) FoldHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		posted := event.GetSettlementLogPosted()
		if posted == nil {
			return nil
		}

		return s.fold(ctx, event, posted)
	}
}

// fold applies ONE ledger row to the shop grain and the user grain.
//
// ⚠ ONE TRANSACTION for the lock check, the dedup claim and every statement
// (#dedup-and-compute-share-one-transaction). A failure rolls the claim back with the compute, so the
// redelivery genuinely reprocesses rather than being recognised as "already done" with nothing folded.
func (s *Service) fold(ctx context.Context, event *eventsv1.Event, posted *eventsv1.SettlementLogPosted) error {
	typeText, ok := settlementTypeText[posted.GetSettlementType()]
	if !ok {
		// NOT acked. An unknown type is money this build cannot file, and silently dropping it would leave
		// the report short with nothing disagreeing — the dead-letter topic is where a person sees it.
		return fmt.Errorf("settlement fold: %s has an unknown settlement_type %v", event.GetEventId(), posted.GetSettlementType())
	}

	column, ok := columnOfType(typeText)
	if !ok {
		return fmt.Errorf("settlement fold: settlement_type %q has no report column", typeText)
	}

	// The day is `posted_on` as the ledger stored it (#posted-on-buckets-the-report) — read, never
	// re-derived from an instant in some other timezone.
	day := posted.GetPostedOn()

	_, err := parseDate(day)
	if err != nil {
		return fmt.Errorf("settlement fold: %s has posted_on %q: %w", event.GetEventId(), day, err)
	}

	raw, err := san_event.Marshal(event)
	if err != nil {
		return err
	}

	// WHO the user grain attributes this row to: the ORDER's creator for an order row
	// (#the-user-is-the-order-creator); for a shop row, the person written on it when there is one — an
	// imported shop row's primary CS (#settlement-asks-the-shop-for-its-primary-cs) — else its ACTOR
	// (#a-shop-addressed-row-is-attributed-to-its-actor).
	user := posted.GetActorId()

	switch {
	case posted.GetOrderId() != 0:
		user = posted.GetOrderCreatedByUserId()
	case posted.GetUserId() != 0:
		user = posted.GetUserId()
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1 · THE MAINTENANCE LOCK, read FOR SHARE. A replay takes the row FOR UPDATE to set it, so a fold
		// already running finishes before the replay's delete begins, and a fold arriving after sees
		// the lock and is redelivered later — the two never interleave.
		locked, err := readEventLock(tx.Clauses(clause.Locking{Strength: "SHARE"}))
		if err != nil {
			return err
		}

		if locked {
			return errFoldLocked
		}

		// 2 · THE CLAIM. Dedup is the write, never a predicate before it: rows affected 0 means this event
		// was already folded, and the transaction commits having written nothing.
		claim := tx.Exec(
			`INSERT INTO settlement_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
			event.GetEventId(), raw, day,
		)
		if claim.Error != nil {
			return claim.Error
		}

		if claim.RowsAffected == 0 {
			return nil
		}

		// 3 · ONE ADVISORY LOCK PER SCOPE, always shop THEN user. A late event and a live one on the same
		// shop would otherwise interleave the prev lookup and the later-day shift and understate a day
		// with nothing detecting it; taking the two in a fixed order is what stops that becoming a
		// deadlock between two events that touch both tables.
		team := strconv.FormatUint(posted.GetTeamId(), 10)

		err = advisoryLock(tx, "settlement-shop:"+team+":"+strconv.FormatUint(posted.GetShopId(), 10))
		if err != nil {
			return err
		}

		err = advisoryLock(tx, "settlement-user:"+team+":"+strconv.FormatUint(user, 10))
		if err != nil {
			return err
		}

		// 4 · THE TWO GRAINS.
		err = foldScope(tx, shopDaily, "shop_settlement_reports", false, posted.GetShopId(), posted.GetTeamId(), day, column, posted.GetChange())
		if err != nil {
			return err
		}

		return foldScope(tx, userDaily, "user_settlement_reports", true, user, posted.GetTeamId(), day, column, posted.GetChange())
	})
}

// foldScope applies one movement to one scope: the day's row, every later day, and the scope's state row.
//
// ⚠ THE CHANGE IS ADDED AS POSTED, never rounded (the-backend-never-rounds-money): posting froze it exact, so every day
// row, carry and position is a sum of exact doubles and equals the log's running sum within the tolerance
// (san_money.Equal) — compared that way, never with ==.
//
// keepsLastDay is the person grain's: its state row also carries `last_day`, the newest day the scope has a row on
// (#the-person-list-reads-the-last-day-from-the-user-report).
//
// The statements are analytic_context.md §How we computed balance, verbatim in shape. ⚠ The day is bound
// as a STRING cast to date everywhere — a Go time.Time is a timestamptz, and comparing a date against it
// moves the boundary by the session's offset.
func foldScope(
	tx *gorm.DB,
	grain reportGrain,
	stateTable string,
	keepsLastDay bool,
	keyID, teamID uint64,
	day, column string,
	change float64,
) error {
	args := map[string]any{
		"day":    day,
		"key":    keyID,
		"team":   teamID,
		"change": change,
	}

	// THE DAY's OWN ROW — one atomic statement, no branch. A new row opens from the scope's LAST row
	// before it (not yesterday's: a quiet day has no row), or at 0 when there is none.
	upsert := fmt.Sprintf(`
INSERT INTO %[1]s AS d (day, %[2]s, team_id, %[3]s, change, open_balance, close_balance, last_updated)
VALUES (
    CAST(@day AS date), @key, @team, @change, @change,
    COALESCE((SELECT p.close_balance FROM %[1]s p
              WHERE p.%[2]s = @key AND p.team_id = @team AND p.day < CAST(@day AS date)
              ORDER BY p.day DESC LIMIT 1), 0),
    COALESCE((SELECT p.close_balance FROM %[1]s p
              WHERE p.%[2]s = @key AND p.team_id = @team AND p.day < CAST(@day AS date)
              ORDER BY p.day DESC LIMIT 1), 0) + @change,
    NOW()
)
ON CONFLICT (%[2]s, team_id, day) DO UPDATE
SET %[3]s         = d.%[3]s + EXCLUDED.%[3]s,
    change        = d.change + EXCLUDED.change,
    close_balance = d.close_balance + EXCLUDED.change,
    last_updated  = NOW()`, grain.table, grain.key, column)

	err := tx.Exec(upsert, args).Error
	if err != nil {
		return fmt.Errorf("settlement fold: %s day row: %w", grain.table, err)
	}

	// EVERY LATER DAY — a SHIFT, never a recomputation. This is what keeps a late event's carry true.
	_, err = shiftLaterDays(tx, grain, keyID, teamID, day, change)
	if err != nil {
		return fmt.Errorf("settlement fold: %s later days: %w", grain.table, err)
	}

	// THE STATE ROW — the scope's NEWEST daily close, DERIVED rather than incremented, so a replay's
	// redelivery re-derives it instead of doubling it.
	err = deriveState(tx, grain, stateTable, keepsLastDay, lastDayRaised, keyID, teamID)
	if err != nil {
		return fmt.Errorf("settlement fold: %s: %w", stateTable, err)
	}

	return nil
}

// shiftLaterDays moves every later day's carried position — `open_balance` and `close_balance`, never a movement column
// — by delta, and says how many rows it moved. The fold shifts by a late event's change; the day re-fold by how far its
// corrected day's close moved (a-refold-shifts-the-later-days). One statement, one definition of the carry.
func shiftLaterDays(tx *gorm.DB, grain reportGrain, keyID, teamID uint64, day string, delta float64) (int64, error) {
	shift := fmt.Sprintf(`
UPDATE %[1]s
SET open_balance  = open_balance + @change,
    close_balance = close_balance + @change,
    last_updated  = NOW()
WHERE %[2]s = @key AND team_id = @team AND day > CAST(@day AS date)`, grain.table, grain.key)

	result := tx.Exec(shift, map[string]any{
		"day":    day,
		"key":    keyID,
		"team":   teamID,
		"change": delta,
	})
	if result.Error != nil {
		return 0, result.Error
	}

	return result.RowsAffected, nil
}

// lastDayRule is how the person grain's state row moves `last_day`.
type lastDayRule int

const (
	// lastDayRaised is the fold's: it only ever adds a day, so an older event leaves `last_day` where it is. GREATEST
	// skips a NULL, which is what a replay leaves on a scope it cut to nothing.
	lastDayRaised lastDayRule = iota
	// lastDayRecomputed is the day re-fold's: it may remove the newest day, so `last_day` is the newest row's, lowered too.
	lastDayRecomputed
)

// deriveState re-derives a scope's state row from its newest daily row — `close_balance`, and on the person grain
// (keepsLastDay) `last_day` (#the-person-list-reads-the-last-day-from-the-user-report). A scope with no daily row
// writes nothing here.
func deriveState(tx *gorm.DB, grain reportGrain, stateTable string, keepsLastDay bool, rule lastDayRule, keyID, teamID uint64) error {
	args := map[string]any{
		"key":  keyID,
		"team": teamID,
	}

	state := fmt.Sprintf(`
INSERT INTO %[3]s (%[2]s, team_id, close_balance, last_updated)
SELECT r.%[2]s, r.team_id, r.close_balance, NOW()
FROM %[1]s r
WHERE r.%[2]s = @key AND r.team_id = @team
ORDER BY r.day DESC
LIMIT 1
ON CONFLICT (%[2]s, team_id) DO UPDATE
SET close_balance = EXCLUDED.close_balance,
    last_updated  = NOW()`, grain.table, grain.key, stateTable)

	if keepsLastDay {
		lastDay := "GREATEST(s.last_day, EXCLUDED.last_day)"
		if rule == lastDayRecomputed {
			lastDay = "EXCLUDED.last_day"
		}

		state = fmt.Sprintf(`
INSERT INTO %[3]s AS s (%[2]s, team_id, close_balance, last_day, last_updated)
SELECT r.%[2]s, r.team_id, r.close_balance, r.day, NOW()
FROM %[1]s r
WHERE r.%[2]s = @key AND r.team_id = @team
ORDER BY r.day DESC
LIMIT 1
ON CONFLICT (%[2]s, team_id) DO UPDATE
SET close_balance = EXCLUDED.close_balance,
    last_day      = %[4]s,
    last_updated  = NOW()`, grain.table, grain.key, stateTable, lastDay)
	}

	return tx.Exec(state, args).Error
}

func advisoryLock(tx *gorm.DB, key string) error {
	err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, key).Error
	if err != nil {
		return fmt.Errorf("settlement fold: advisory lock %s: %w", key, err)
	}

	return nil
}
