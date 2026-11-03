package inventory_ledgers

import (
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
)

// THE COUNT LOCK (the-lock-is-the-open-snapshot-row). A product on a rack is being counted while an
// `opname_session_snapshots` row over it has no `released_at`. Nothing may move its units there — no put-away, no move,
// no sample, no adjustment — and an order's take still runs, from the unlocked racks first
// (a-lock-stops-units-moving-not-sales).
//
// ⚠ READ IT AFTER THE RACK ROWS ARE LOCKED, IN A STATEMENT OF ITS OWN. A count is planned under a lock on the same
// product_placements rows (OpnameSessionCreate, OpnameRowAddFound), so a writer that locked them first is queued ahead of
// the count, and one that waited for them reads the count's committed rows in its NEXT statement. Folded into the locking
// SELECT as a subquery, the check would read the snapshot taken when that statement began — before the count it waited
// for committed — and let the write through under a lock the count already holds.

// CountLock is one open snapshot row: who is counting this product on this rack.
type CountLock struct {
	RackKey
	SessionID     uint64
	StartedByID   uint64
	StartedAt     time.Time
	PlacementCode string
}

// wib is the warehouse's clock, for a refusal a person reads.
var wib = time.FixedZone("WIB", 7*60*60)

// CountedError refuses a write that would move units a count holds. It names the session, who started it and when, so
// whoever is blocked knows whom to ask (an-abandoned-count-waits-for-the-admin).
type CountedError struct {
	CountLock
}

func (e *CountedError) Error() string {
	return fmt.Sprintf("product %d on rack %s is being counted — count #%d, started by user #%d at %s; "+
		"it is released when the count is finalized or cancelled",
		e.ProductID, e.PlacementCode, e.SessionID, e.StartedByID, e.StartedAt.In(wib).Format("2006-01-02 15:04 MST"))
}

// CountLocks reads the open snapshot rows over the given rack rows, keyed by rack row. One statement whatever the number
// of keys (ledger-writes-are-set-based).
func CountLocks(tx *gorm.DB, keys []RackKey) (map[RackKey]CountLock, error) {
	out := map[RackKey]CountLock{}
	if len(keys) == 0 {
		return out, nil
	}

	pairs := make([][]any, 0, len(keys))
	seen := make(map[RackKey]bool, len(keys))

	for _, k := range keys {
		if seen[k] {
			continue
		}

		seen[k] = true
		pairs = append(pairs, []any{k.ProductID, k.PlacementID})
	}

	var rows []struct {
		ProductID     uint64
		PlacementID   uint64
		SessionID     uint64
		StartedByID   uint64
		StartedAt     time.Time
		PlacementCode string
	}

	err := tx.Raw(`
		SELECT s.product_id, s.placement_id, s.opname_session_id AS session_id,
		       o.created_by_id AS started_by_id, o.created_at AS started_at, p.code AS placement_code
		FROM opname_session_snapshots s
		JOIN opname_sessions o ON o.id = s.opname_session_id
		JOIN placements p ON p.id = s.placement_id
		WHERE s.released_at IS NULL AND (s.product_id, s.placement_id) IN ?`, pairs).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("read count locks over %d rack row(s): %w", len(pairs), err)
	}

	for _, r := range rows {
		k := RackKey{ProductID: r.ProductID, PlacementID: r.PlacementID}
		out[k] = CountLock{
			RackKey: k, SessionID: r.SessionID, StartedByID: r.StartedByID, StartedAt: r.StartedAt, PlacementCode: r.PlacementCode,
		}
	}

	return out, nil
}

// RefuseCounted refuses the write when any of the rack rows is being counted — a *CountedError for the first, in
// (product, rack) order, so the same write is always refused with the same words. Call it after the rows are locked.
func RefuseCounted(tx *gorm.DB, keys []RackKey) error {
	locks, err := CountLocks(tx, keys)
	if err != nil {
		return err
	}

	if len(locks) == 0 {
		return nil
	}

	held := make([]RackKey, 0, len(locks))
	for k := range locks {
		held = append(held, k)
	}

	sortRackKeys(held)

	return &CountedError{CountLock: locks[held[0]]}
}

// keysOfRows is the rack keys of locked rack rows.
func keysOfRows(locked *LockedRacks) []RackKey {
	keys := make([]RackKey, 0)

	for _, rows := range locked.byOwner {
		for _, r := range rows {
			keys = append(keys, RackKey{ProductID: r.ProductID, PlacementID: r.PlacementID})
		}
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].ProductID != keys[j].ProductID {
			return keys[i].ProductID < keys[j].ProductID
		}

		return keys[i].PlacementID < keys[j].PlacementID
	})

	return keys
}
