// Package san_table_mirroring reports the rows of a Postgres table that changed since the caller last
// acknowledged them — new, modified or deleted — by hashing every row with hashtext(row::text) and
// comparing that with the hash stored when the row was last acknowledged.
//
// Spec: docs/technical/packages/table_mirroring/context.md (owner) and its context_decision.md. It is a
// building block for a SCHEDULED job that mirrors the old system's database into revamp
// (the-mirror-runs-on-a-schedule):
//
//	err = san_table_mirroring.TrackTable[*User](ctx, oldDB, "public.users",
//		func(ctx context.Context, change san_table_mirroring.Change[*User]) error {
//			// write change.Data (or remove change.ID) on your side, then:
//			return change.Ack(oldDB)
//		})
//
// What it keeps, for a tracked schema S, INSIDE the tracked database
// (the-track-schema-lives-in-the-old-database):
//
//	S_track.configurations   id, name (unique), value — max_delete_percent lives here
//	S_track.tracked_tables   id, table_name (unique)
//	S_track.<table>_track    id (the source row's id), last_hash, last_change
//
// The package creates them itself on the first call for a table (the-package-creates-its-track-schema),
// so the database role it connects with must be allowed to create a schema there.
//
// Usage, the errors and what a scheduler does with each, and the operator's steps: README.md beside
// this file. Runnable programs (one change at a time, batched, a scheduled job): examples/.
//
// Delivery is AT LEAST ONCE. Ack writes to the tracked database while the handler's own write usually
// goes somewhere else, so a crash between the two sends the same change again on the next run. A handler
// must be safe to repeat — an upsert by ID, a delete that tolerates "already gone".
package san_table_mirroring

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// ChangeType says what happened to a row since it was last acknowledged.
type ChangeType string

const (
	// ChangeTypeNew is a row the track table has never acknowledged.
	ChangeTypeNew ChangeType = "new"
	// ChangeTypeModified is a row whose hash differs from the acknowledged one. A soft delete (a
	// deleted_at being set) arrives as this — the row is still there, it just changed.
	ChangeTypeModified ChangeType = "modified"
	// ChangeTypeDeleted is an acknowledged row that is no longer in the source table (a hard delete).
	ChangeTypeDeleted ChangeType = "deleted"
)

// Change is one changed row, handed to TrackTable's handler.
type Change[T any] struct {
	// ID is the source row's primary key (only-single-column-keys-are-supported).
	ID     uint64
	Change ChangeType

	// CurrentHash is hashtext(row::text) as the row is now. 0 for a deleted row.
	CurrentHash int
	// LastHash is the hash stored by the last Ack. 0 for a new row.
	LastHash int

	// Data is the row as it is NOW. The package keeps no earlier version: a caller that needs the
	// "before" keeps its own copy (the-caller-keeps-the-before). For a deleted row there is nothing left
	// to read, so Data is the zero value of T and ID is all there is.
	Data T

	// track is the quoted "<schema>_track"."<table>_track" this change acknowledges into.
	track string
}

// Ack records the change as handled, so the next run does not send it again:
//   - new / modified: stores CurrentHash — the hash read when the change was SENT, never a fresh one,
//     so an edit made while the handler ran still differs next time and is sent again;
//   - deleted: removes the track row, so the same id coming back later arrives as new.
//
// db must reach the TRACKED database (the one TrackTable was given, or a transaction on it).
func (c Change[T]) Ack(db *gorm.DB) error {
	if c.track == "" {
		return ErrNotFromTrackTable
	}

	var err error

	switch c.Change {
	case ChangeTypeNew, ChangeTypeModified:
		err = db.
			Exec(
				`INSERT INTO `+c.track+` (id, last_hash, last_change) VALUES (?, ?, now())
				ON CONFLICT (id) DO UPDATE SET last_hash = EXCLUDED.last_hash, last_change = EXCLUDED.last_change`,
				int64(c.ID),
				c.CurrentHash,
			).
			Error
	case ChangeTypeDeleted:
		err = db.
			Exec(`DELETE FROM `+c.track+` WHERE id = ?`, int64(c.ID)).
			Error
	default:
		return fmt.Errorf("san_table_mirroring: ack of unknown change type %q", c.Change)
	}

	if err != nil {
		return fmt.Errorf("san_table_mirroring: ack %s id %d: %w", c.track, c.ID, err)
	}

	return nil
}

// ackChunk is how many rows one AckAll statement writes (two parameters each).
const ackChunk = 5000

// AckAll acknowledges many changes in a few statements, in one transaction — what Ack does, batched.
// Ack is one round trip per change (≈1 ms here, so ≈17 minutes for a first run of a million rows); a
// handler can instead collect its changes, write them on its side in a batch, then AckAll them, and
// flush the rest after TrackTable returns. Changes from several tables may be mixed. If the same row
// appears twice, the later change wins.
func AckAll[T any](db *gorm.DB, changes []Change[T]) error {
	if len(changes) == 0 {
		return nil
	}

	type key struct {
		track string
		id    uint64
	}

	last := make(map[key]Change[T], len(changes))
	order := make([]key, 0, len(changes))

	for _, c := range changes {
		if c.track == "" {
			return ErrNotFromTrackTable
		}

		switch c.Change {
		case ChangeTypeNew, ChangeTypeModified, ChangeTypeDeleted:
		default:
			return fmt.Errorf("san_table_mirroring: ack of unknown change type %q", c.Change)
		}

		k := key{track: c.track, id: c.ID}
		if _, seen := last[k]; !seen {
			order = append(order, k)
		}

		last[k] = c
	}

	type batch struct {
		upserts []any // id, hash, id, hash, ...
		deletes []int64
	}

	tracks := []string{}
	byTrack := map[string]*batch{}

	for _, k := range order {
		b := byTrack[k.track]
		if b == nil {
			b = &batch{}
			byTrack[k.track] = b
			tracks = append(tracks, k.track)
		}

		c := last[k]
		if c.Change == ChangeTypeDeleted {
			b.deletes = append(b.deletes, int64(c.ID))
		} else {
			b.upserts = append(b.upserts, int64(c.ID), c.CurrentHash)
		}
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		for _, track := range tracks {
			b := byTrack[track]

			for start := 0; start < len(b.upserts); start += 2 * ackChunk {
				end := min(start+2*ackChunk, len(b.upserts))
				values := strings.TrimSuffix(strings.Repeat("(?, ?, now()), ", (end-start)/2), ", ")

				err := tx.
					Exec(
						`INSERT INTO `+track+` (id, last_hash, last_change) VALUES `+values+`
						ON CONFLICT (id) DO UPDATE SET last_hash = EXCLUDED.last_hash, last_change = EXCLUDED.last_change`,
						b.upserts[start:end]...,
					).
					Error
				if err != nil {
					return err
				}
			}

			for start := 0; start < len(b.deletes); start += ackChunk {
				end := min(start+ackChunk, len(b.deletes))

				err := tx.
					Exec(`DELETE FROM `+track+` WHERE id IN ?`, b.deletes[start:end]).
					Error
				if err != nil {
					return err
				}
			}
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("san_table_mirroring: ack %d changes: %w", len(changes), err)
	}

	return nil
}

var (
	// ErrStillRunning: the previous run for this table still holds its lock, so this run scanned,
	// sent and acknowledged nothing (an-overlapping-run-skips-the-table). A scheduler logs it as a skip.
	ErrStillRunning = errors.New("san_table_mirroring: the previous run for this table is still going")

	// ErrUnsupportedTable: the table's primary key is not ONE integer column, or its name is too long
	// for its track name. Nothing was created (only-single-column-keys-are-supported).
	ErrUnsupportedTable = errors.New("san_table_mirroring: table not supported")

	// ErrTableNotFound: the name does not resolve to a table.
	ErrTableNotFound = errors.New("san_table_mirroring: table not found")

	// ErrTooManyDeletes: matched by every *TooManyDeletesError.
	ErrTooManyDeletes = errors.New("san_table_mirroring: too many rows deleted")

	// ErrNotFromTrackTable: Ack on a Change that TrackTable did not send.
	ErrNotFromTrackTable = errors.New("san_table_mirroring: ack of a change TrackTable did not send")
)

// TooManyDeletesError: the run found more deletions than the guard allows, so it sent NOTHING — no new,
// no modified, no deleted (deletes-are-reported-and-a-mass-delete-stops-the-run). The likely cause is a
// table caught half-empty (truncated and being refilled, or restored). A genuine purge goes through by
// raising max_delete_percent in ConfigTable for one run (the-delete-guard-is-ten-percent-over-fifty).
type TooManyDeletesError struct {
	Table        string  // schema.table
	Deletions    int64   // tracked rows no longer in the source
	Tracked      int64   // tracked rows before the run
	LimitPercent float64 // max_delete_percent in force
	ConfigTable  string  // where max_delete_percent lives
}

func (e *TooManyDeletesError) Error() string {
	return fmt.Sprintf(
		"san_table_mirroring: %s: %d of %d tracked rows are gone (%.1f%%), over max_delete_percent %g — nothing was sent; raise max_delete_percent in %s to let it through",
		e.Table,
		e.Deletions,
		e.Tracked,
		float64(e.Deletions)*100/float64(e.Tracked),
		e.LimitPercent,
		e.ConfigTable,
	)
}

func (e *TooManyDeletesError) Unwrap() error {
	return ErrTooManyDeletes
}
