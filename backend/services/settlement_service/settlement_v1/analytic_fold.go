package settlement_v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
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
	// (#the-user-is-the-order-creator), the row's ACTOR for a shop row
	// (#a-shop-addressed-row-is-attributed-to-its-actor).
	user := posted.GetActorId()
	if posted.GetOrderId() != 0 {
		user = posted.GetOrderCreatedByUserId()
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
		err = foldScope(tx, shopDaily, "shop_settlement_reports", posted.GetShopId(), posted.GetTeamId(), day, column, posted.GetChange())
		if err != nil {
			return err
		}

		return foldScope(tx, userDaily, "user_settlement_reports", user, posted.GetTeamId(), day, column, posted.GetChange())
	})
}

// foldScope applies one movement to one scope: the day's row, every later day, and the scope's state row.
//
// The statements are analytic_context.md §How we computed balance, verbatim in shape. ⚠ The day is bound
// as a STRING cast to date everywhere — a Go time.Time is a timestamptz, and comparing a date against it
// moves the boundary by the session's offset.
func foldScope(
	tx *gorm.DB,
	grain reportGrain,
	stateTable string,
	keyID, teamID uint64,
	day, column string,
	change int64,
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
	shift := fmt.Sprintf(`
UPDATE %[1]s
SET open_balance  = open_balance + @change,
    close_balance = close_balance + @change,
    last_updated  = NOW()
WHERE %[2]s = @key AND team_id = @team AND day > CAST(@day AS date)`, grain.table, grain.key)

	err = tx.Exec(shift, args).Error
	if err != nil {
		return fmt.Errorf("settlement fold: %s later days: %w", grain.table, err)
	}

	// THE STATE ROW — the scope's NEWEST daily close, DERIVED rather than incremented, so a replay's
	// redelivery re-derives it instead of doubling it.
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

	err = tx.Exec(state, args).Error
	if err != nil {
		return fmt.Errorf("settlement fold: %s: %w", stateTable, err)
	}

	return nil
}

func advisoryLock(tx *gorm.DB, key string) error {
	err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, key).Error
	if err != nil {
		return fmt.Errorf("settlement fold: advisory lock %s: %w", key, err)
	}

	return nil
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
// ⚠ A MISSING OR UNPARSEABLE VALUE IS AN ERROR, never "unlocked". For a lock, failing open is the wrong
// direction: the guard would silently stop existing at exactly the moment it is misconfigured.
func readEventLock(tx *gorm.DB) (bool, error) {
	var meta settlement_service_models.SettlementServiceMetadata

	err := tx.
		Where("key = ?", settlement_service_models.MetadataProcessEventLock).
		Take(&meta).
		Error
	if err != nil {
		return false, fmt.Errorf("settlement: cannot read %s: %w", settlement_service_models.MetadataProcessEventLock, err)
	}

	return parseEventLock(meta.Value)
}

func parseEventLock(value string) (bool, error) {
	decoded := eventLockValue{}

	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()

	err := decoder.Decode(&decoded)
	if err != nil || decoded.Lock == nil {
		return false, fmt.Errorf("settlement: %s is %q, not {\"lock\":true|false}",
			settlement_service_models.MetadataProcessEventLock, value)
	}

	return *decoded.Lock, nil
}
