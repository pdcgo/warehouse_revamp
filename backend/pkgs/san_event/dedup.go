package san_event

import (
	"context"
	"fmt"
	"regexp"

	"gorm.io/gorm"
)

// EventDedup decides whether this service has already seen an event.
//
// ⚠ DEDUP IS THE WRITE, NEVER A PREDICATE BEFORE IT. There is deliberately no IsDuplicate(e) bool: a
// check evaluated first has a check-then-act race, because a redelivery arrives while the first attempt
// is still running. Both read "not present", both proceed, and the bucket is counted twice.
//
// So Claim decides BY the insert, inside the caller's transaction. Note the redundancy in the
// alternative: a separate check is only safe if a unique index exists — and once one does, the check has
// nothing left to do.
type EventDedup interface {
	// Claim records the event and reports whether it was new. isNew=false means already seen.
	//
	// It MUST run in the same transaction as the handler's work, or a crash between them leaves an
	// event claimed but unprocessed — permanently, since the claim suppresses the redelivery.
	Claim(ctx context.Context, tx *gorm.DB, e Event) (isNew bool, err error)
}

// A table name is bound from code, never from a request, but it is interpolated into SQL because
// Postgres cannot parameterise an identifier — so it is checked rather than trusted.
var validTableName = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// NewDedup returns the default EventDedup over a minimal table shape: event_id with a unique index on
// it, plus occurred_at_unix.
//
// The service owns the table, its migration, its retention and every other column. The library ships
// this because twelve hand-written ON CONFLICT statements is a lot of surface for SQL with several easy
// mistakes in it — DO NOTHING vs DO UPDATE, rows-affected vs returned row, naming the right conflict
// target.
//
// ⚠ THE TABLE IS BOUND HERE, AND NOWHERE ELSE — never passed per call. The table IS the dedup scope, so
// a misrouted write fails SILENTLY: ON CONFLICT DO NOTHING swallows it, the driver ACKs, and the
// intended consumer is permanently short. Without dedup you would at least get a visible duplicate.
//
// A service substitutes its own implementation when it genuinely differs — typed columns, or a natural
// key as the conflict target.
func NewDedup(table string) (EventDedup, error) {
	if !validTableName.MatchString(table) {
		return nil, fmt.Errorf("san_event: %q is not a valid table name", table)
	}

	return &defaultDedup{table: table}, nil
}

type defaultDedup struct {
	table string
}

// Claim implements [EventDedup].
func (d *defaultDedup) Claim(ctx context.Context, tx *gorm.DB, e Event) (bool, error) {
	// received_at is left to the column DEFAULT rather than written here, on purpose. GORM's
	// autoCreateTime silently OVERRIDES a DEFAULT now(), which is how a table ends up with two clocks;
	// raw SQL that never names the column cannot do that.
	statement := fmt.Sprintf(
		`INSERT INTO %s (event_id, occurred_at_unix) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING`,
		d.table,
	)

	result := tx.WithContext(ctx).Exec(statement, e.GetEventId(), e.GetOccurredAtUnix())

	err := result.Error
	if err != nil {
		return false, fmt.Errorf("san_event: cannot claim %q in %s: %w", e.GetEventId(), d.table, err)
	}

	return result.RowsAffected == 1, nil
}
