package supplier_v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// THE REPLAY'S LOCK, `process_event_lock` — a LEASE of one minute (a-dead-replays-lock-expires-after-a-minute).
//
// Only a replay writes it (only-the-replay-holds-the-lock), for its delete and its seek — seconds. A replay that dies
// holding it — a deploy, a crash, a restart — no longer stops the figures for good: a minute after it was taken, the
// lock counts as released, to the fold and to the next replay alike, and nobody resets it by hand.
//
// The age is the row's `updated_at` against the DATABASE's clock — the take stamps it NOW() — so no server's clock can
// disagree with it. The retries reach past the minute (5 attempts from a 10 s backoff, event_source), so an event
// refused while a dead replay's lock was still fresh is folded on a later attempt, never dead-lettered.
const eventLockLease = time.Minute

var (
	lockOn  = `{"lock":true}`
	lockOff = `{"lock":false}`

	// The lease as Postgres reads an interval.
	eventLockLeaseSQL = fmt.Sprintf("%d seconds", int(eventLockLease/time.Second))

	errEventLockUnreadable = errors.New("supplier: process_event_lock is not {\"lock\":true|false}")
)

// eventLockValue is the ONE encoding of `process_event_lock`.
type eventLockValue struct {
	Lock *bool `json:"lock"`
}

// eventLockRow is the lock as the database sees it NOW: its value, when it was last set, and whether that is older than
// the lease.
type eventLockRow struct {
	Value     string
	UpdatedAt time.Time
	Expired   bool
}

func eventLockState(tx *gorm.DB) (eventLockRow, error) {
	var row eventLockRow

	err := tx.
		Model(&supplier_service_models.SupplierServiceMetadata{}).
		Select("value, updated_at, updated_at < NOW() - CAST(? AS interval) AS expired", eventLockLeaseSQL).
		Where("key = ?", supplier_service_models.MetadataProcessEventLock).
		Take(&row).
		Error
	if err != nil {
		return row, fmt.Errorf("supplier: cannot read %s: %w", supplier_service_models.MetadataProcessEventLock, err)
	}

	return row, nil
}

// readEventLock is the FOLD's question: is the lock held? An `on` lock older than the lease is a dead replay's, and reads
// as released — logged once.
//
// ⚠ A MISSING OR UNPARSEABLE VALUE IS AN ERROR, never "unlocked". For a lock, failing open is the wrong direction: the
// guard would silently stop existing at exactly the moment it is misconfigured.
func readEventLock(tx *gorm.DB) (bool, error) {
	row, err := eventLockState(tx)
	if err != nil {
		return false, err
	}

	on, err := parseEventLock(row.Value)
	if err != nil {
		return false, err
	}

	if on && row.Expired {
		logExpiredEventLock(tx.Statement.Context, row.UpdatedAt)

		return false, nil
	}

	return on, nil
}

// takeEventLock is the REPLAY's: it takes the lock when it is off, or on for longer than the lease — a dead replay's,
// which would otherwise refuse every replay after it too. The row is locked for the check and the write, so two replays
// cannot both take it. It returns when the lock was taken, which the release names.
func (s *Service) takeEventLock(ctx context.Context) (time.Time, bool, error) {
	var (
		takenAt  time.Time
		acquired bool
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, err := eventLockState(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
		if err != nil {
			return err
		}

		on, err := parseEventLock(row.Value)
		if err != nil {
			return err
		}

		if on && !row.Expired {
			return nil
		}

		if on {
			logExpiredEventLock(ctx, row.UpdatedAt)
		}

		var taken struct{ UpdatedAt time.Time }

		err = tx.Raw(
			`UPDATE supplier_service_metadata SET value = ?, updated_at = NOW() WHERE key = ? RETURNING updated_at`,
			lockOn, supplier_service_models.MetadataProcessEventLock,
		).Scan(&taken).Error
		if err != nil {
			return err
		}

		takenAt, acquired = taken.UpdatedAt, true

		return nil
	})

	return takenAt, acquired, err
}

// releaseEventLock lets go of the lock this replay took at `takenAt` — and ONLY that one. A replay that outlived its
// lease may find the lock taken by the next replay, and releasing that one would let the fold run into its delete.
func (s *Service) releaseEventLock(ctx context.Context, takenAt time.Time) (bool, error) {
	result := s.db.WithContext(ctx).
		Model(&supplier_service_models.SupplierServiceMetadata{}).
		Where("key = ? AND value = ? AND updated_at = ?", supplier_service_models.MetadataProcessEventLock, lockOn, takenAt).
		Updates(map[string]any{
			"value":      lockOff,
			"updated_at": gorm.Expr("NOW()"),
		})
	if result.Error != nil {
		return false, result.Error
	}

	return result.RowsAffected == 1, nil
}

// expiredEventLocks remembers which expired locks this process has reported — by when each was taken — so a dead
// replay is logged ONCE, not once per event that finds it.
var expiredEventLocks sync.Map

func logExpiredEventLock(ctx context.Context, takenAt time.Time) {
	_, seen := expiredEventLocks.LoadOrStore(takenAt.UnixNano(), true)
	if seen {
		return
	}

	slog.ErrorContext(ctx, "process_event_lock is past its lease — the replay that took it died holding it, so it counts as released",
		"taken_at", takenAt, "lease", eventLockLease.String())
}

func parseEventLock(value string) (bool, error) {
	decoded := eventLockValue{}

	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()

	err := decoder.Decode(&decoded)
	if err != nil || decoded.Lock == nil {
		return false, fmt.Errorf("%w: %q", errEventLockUnreadable, value)
	}

	return *decoded.Lock, nil
}
