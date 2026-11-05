package san_table_mirroring

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

const (
	// deleteFloor: a run never stops for this many deletions or fewer, so a small table cannot trip
	// the guard (the-delete-guard-is-ten-percent-over-fifty).
	deleteFloor = 50
)

// pageSize is how many source rows one query hashes. A var so tests can page through a handful.
var pageSize = 1000

// pinnedSettings fixes every session setting that changes how a row PRINTS, and so its
// hashtext(row::text), for the run's transaction only (hashtext-stays-and-the-settings-are-pinned).
// Without it, a run whose connection has another TimeZone sends every row of every table as modified.
// lc_monetary is pinned too: a money column prints its currency symbol from it.
const pinnedSettings = `SELECT
	set_config('TimeZone', 'UTC', true),
	set_config('DateStyle', 'ISO, MDY', true),
	set_config('IntervalStyle', 'postgres', true),
	set_config('extra_float_digits', '1', true),
	set_config('bytea_output', 'hex', true),
	set_config('lc_monetary', 'C', true)`

// TrackTable sends every row of tablename that changed since its last Ack to handler, one Change at a
// time, ordered by ID: first the new and modified rows, then the deleted ones. A row the handler does
// not Ack is sent again by the next run.
//
// tablename is "schema.table", or a bare "table" found through the connection's search_path. Its
// primary key must be ONE integer column, and T a struct (or pointer to one) with a field for that
// column; any other table is refused with ErrUnsupportedTable before anything is created.
//
// One run, in order:
//  1. the first call for a table creates its track tables (committed on their own);
//  2. a per-table advisory lock: held by an earlier run → ErrStillRunning, nothing scanned;
//  3. the session settings that change how a row prints are pinned;
//  4. the delete guard: more than 50 deletions AND more than max_delete_percent of the tracked rows →
//     *TooManyDeletesError, and NOTHING is sent;
//  5. new and modified rows, a page of source rows at a time;
//  6. deleted rows.
//
// The run is one READ COMMITTED transaction on db that only reads; the lock goes with it, so a crashed
// run never blocks the next. A handler error stops the run and is returned (wrapped, so errors.Is
// works); what was already acknowledged stays acknowledged.
func TrackTable[T any](
	ctx context.Context,
	db *gorm.DB,
	tablename string,
	handler func(ctx context.Context, change Change[T]) error,
) error {
	if handler == nil {
		return fmt.Errorf("san_table_mirroring: TrackTable needs a handler")
	}

	db = db.WithContext(ctx)

	tb, err := resolveTable(db, tablename)
	if err != nil {
		return err
	}

	idOf, err := idReader[T](db, tb.pk)
	if err != nil {
		return err
	}

	err = ensureTrack(db, tb)
	if err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		return run(ctx, tx, tb, idOf, handler)
	})
}

func run[T any](
	ctx context.Context,
	tx *gorm.DB,
	tb *table,
	idOf func(T) (int64, error),
	handler func(ctx context.Context, change Change[T]) error,
) error {
	var locked bool

	err := tx.
		Raw(`SELECT pg_try_advisory_xact_lock(hashtext(?), hashtext(?))`, lockSpaceRun, tb.label).
		Scan(&locked).
		Error
	if err != nil {
		return fmt.Errorf("san_table_mirroring: lock %s: %w", tb.label, err)
	}

	if !locked {
		return fmt.Errorf("%w: %s", ErrStillRunning, tb.label)
	}

	err = tx.
		Exec(pinnedSettings).
		Error
	if err != nil {
		return fmt.Errorf("san_table_mirroring: pin the session settings: %w", err)
	}

	deletions, err := guardDeletes(tx, tb)
	if err != nil {
		return err
	}

	err = sendChanged(ctx, tx, tb, idOf, handler)
	if err != nil {
		return err
	}

	if deletions == 0 {
		return nil
	}

	return sendDeleted(ctx, tx, tb, handler)
}

type deleteCount struct {
	Tracked int64 `gorm:"column:tracked"`
	Deleted int64 `gorm:"column:deleted"`
}

// guardDeletes counts the tracked rows that are gone from the source and stops the run — before
// anything is sent — when there are more than deleteFloor of them AND more than max_delete_percent of
// the tracked rows (the-delete-guard-is-ten-percent-over-fifty). It returns the count.
//
// The limit is read and checked on EVERY run, not only when it is needed: a typo in it then fails the
// next run, instead of waiting for the one mass delete it was meant to stop.
func guardDeletes(tx *gorm.DB, tb *table) (int64, error) {
	limit, err := maxDeletePercent(tx, tb)
	if err != nil {
		return 0, err
	}

	var count deleteCount

	err = tx.
		Raw(
			`SELECT
				(SELECT count(*) FROM ` + tb.track + `) AS tracked,
				(SELECT count(*) FROM ` + tb.track + ` AS tr
					WHERE NOT EXISTS (SELECT 1 FROM ` + tb.src + ` AS s WHERE s.` + tb.pkCol + ` = tr.id)) AS deleted`,
		).
		Scan(&count).
		Error
	if err != nil {
		return 0, fmt.Errorf("san_table_mirroring: count the deletions of %s: %w", tb.label, err)
	}

	if count.Deleted <= deleteFloor {
		return count.Deleted, nil
	}

	if float64(count.Deleted)*100 > limit*float64(count.Tracked) {
		return 0, &TooManyDeletesError{
			Table:        tb.label,
			Deletions:    count.Deleted,
			Tracked:      count.Tracked,
			LimitPercent: limit,
			ConfigTable:  tb.configs,
		}
	}

	return count.Deleted, nil
}

// maxDeletePercent reads max_delete_percent from the track schema's configurations: 10 when the row is
// absent, an error when it is not a number from 0 up — a typo must not silently switch the guard off.
func maxDeletePercent(tx *gorm.DB, tb *table) (float64, error) {
	var values []string

	err := tx.
		Raw(`SELECT value FROM `+tb.configs+` WHERE name = ?`, maxDeletePercentName).
		Scan(&values).
		Error
	if err != nil {
		return 0, fmt.Errorf("san_table_mirroring: read %s: %w", maxDeletePercentName, err)
	}

	if len(values) == 0 {
		return defaultMaxDeletePercent, nil
	}

	limit, err := strconv.ParseFloat(strings.TrimSpace(values[0]), 64)
	if err != nil || math.IsNaN(limit) || math.IsInf(limit, 0) || limit < 0 {
		return 0, fmt.Errorf("san_table_mirroring: %s %s = %q is not a percentage", tb.configs, maxDeletePercentName, values[0])
	}

	return limit, nil
}

type changedRow struct {
	PageEnd     *int64 `gorm:"column:page_end"`
	PageRows    int64  `gorm:"column:page_rows"`
	ID          *int64 `gorm:"column:id"`
	CurrentHash int    `gorm:"column:current_hash"`
	LastHash    int    `gorm:"column:last_hash"`
	IsNew       bool   `gorm:"column:is_new"`
}

// sendChanged walks the source by primary key, pageSize rows per query (changedQuery), and hands over
// the rows that are new or differ.
func sendChanged[T any](
	ctx context.Context,
	tx *gorm.DB,
	tb *table,
	idOf func(T) (int64, error),
	handler func(ctx context.Context, change Change[T]) error,
) error {
	query := changedQuery(tb)

	cursor := int64(math.MinInt64)

	for {
		err := ctx.Err()
		if err != nil {
			return err
		}

		var page []changedRow

		err = tx.
			Raw(query, cursor, pageSize).
			Scan(&page).
			Error
		if err != nil {
			return fmt.Errorf("san_table_mirroring: hash a page of %s: %w", tb.label, err)
		}

		if len(page) == 0 || page[0].PageRows == 0 {
			return nil
		}

		ids := make([]int64, 0, len(page))
		for _, p := range page {
			if p.ID != nil {
				ids = append(ids, *p.ID)
			}
		}

		if len(ids) > 0 {
			err = sendPage(ctx, tx, tb, idOf, handler, page, ids)
			if err != nil {
				return err
			}
		}

		if page[0].PageRows < int64(pageSize) {
			return nil
		}

		cursor = *page[0].PageEnd
	}
}

// sendPage reads the changed rows of one page into T and hands them over in ID order. A row deleted
// between the hash and this read is skipped — the next run reports it deleted. A row edited in between
// arrives with its newer Data but the older CurrentHash, so it differs again next run and is resent.
func sendPage[T any](
	ctx context.Context,
	tx *gorm.DB,
	tb *table,
	idOf func(T) (int64, error),
	handler func(ctx context.Context, change Change[T]) error,
	page []changedRow,
	ids []int64,
) error {
	var rows []T

	err := tx.
		Raw(`SELECT * FROM `+tb.src+` WHERE `+tb.pkCol+` IN ?`, ids).
		Scan(&rows).
		Error
	if err != nil {
		return fmt.Errorf("san_table_mirroring: read changed rows of %s: %w", tb.label, err)
	}

	byID := make(map[int64]T, len(rows))
	for _, row := range rows {
		id, err := idOf(row)
		if err != nil {
			return err
		}

		byID[id] = row
	}

	for _, p := range page {
		if p.ID == nil {
			continue
		}

		data, ok := byID[*p.ID]
		if !ok {
			continue
		}

		change := Change[T]{
			ID:          uint64(*p.ID),
			Change:      ChangeTypeModified,
			CurrentHash: p.CurrentHash,
			LastHash:    p.LastHash,
			Data:        data,
			track:       tb.track,
		}
		if p.IsNew {
			change.Change = ChangeTypeNew
		}

		err = handler(ctx, change)
		if err != nil {
			return fmt.Errorf("san_table_mirroring: %s id %d: %w", tb.label, *p.ID, err)
		}
	}

	return nil
}

type deletedRow struct {
	PageEnd  *int64 `gorm:"column:page_end"`
	PageRows int64  `gorm:"column:page_rows"`
	ID       *int64 `gorm:"column:id"`
	LastHash int    `gorm:"column:last_hash"`
}

// sendDeleted walks the TRACK table by id, pageSize rows per query (deletedQuery), and hands over each
// tracked row whose id is gone from the source, with ID and LastHash only.
func sendDeleted[T any](
	ctx context.Context,
	tx *gorm.DB,
	tb *table,
	handler func(ctx context.Context, change Change[T]) error,
) error {
	query := deletedQuery(tb)

	cursor := int64(math.MinInt64)

	for {
		err := ctx.Err()
		if err != nil {
			return err
		}

		var page []deletedRow

		err = tx.
			Raw(query, cursor, pageSize).
			Scan(&page).
			Error
		if err != nil {
			return fmt.Errorf("san_table_mirroring: find deleted rows of %s: %w", tb.label, err)
		}

		if len(page) == 0 || page[0].PageRows == 0 {
			return nil
		}

		for _, p := range page {
			if p.ID == nil {
				continue
			}

			var zero T

			err = handler(ctx, Change[T]{
				ID:       uint64(*p.ID),
				Change:   ChangeTypeDeleted,
				LastHash: p.LastHash,
				Data:     zero,
				track:    tb.track,
			})
			if err != nil {
				return fmt.Errorf("san_table_mirroring: %s id %d: %w", tb.label, *p.ID, err)
			}
		}

		if page[0].PageRows < int64(pageSize) {
			return nil
		}

		cursor = *page[0].PageEnd
	}
}

// changedQuery hashes ONE page of source rows — the next pageSize keys after the cursor, an index range
// — and returns only those that are new or differ from their track row, plus where the page ended and
// how many rows it held, so a page with no change still moves the cursor. Only changed rows leave the
// database (the-track-schema-lives-in-the-old-database).
//
// Every row of the page looks its track row up by key in a correlated subquery, never a join. As a
// join the planner hashed the WHOLE track table once per page (measured: a seq scan of 200.000 track
// rows under every page of 1.000), which makes a run cost a pass per page instead of one pass.
// TestPerf_TrackTable reads the plan and refuses a seq scan.
//
// The cursor is cast to bigint: Postgres would otherwise type it as the key column, and an integer key
// cannot hold the starting cursor (the smallest int64); int4 > int8 still walks the key's index. The
// row is hashed through the alias san_tm_row, so no column of the table can shadow the whole-row
// reference.
func changedQuery(tb *table) string {
	return `WITH page AS (
			SELECT san_tm_row.` + tb.pkCol + ` AS id, hashtext(san_tm_row::text) AS current_hash
			FROM ` + tb.src + ` AS san_tm_row
			WHERE san_tm_row.` + tb.pkCol + ` > ?::bigint
			ORDER BY san_tm_row.` + tb.pkCol + `
			LIMIT ?
		),
		looked AS (
			SELECT p.id, p.current_hash,
				(SELECT tr.last_hash FROM ` + tb.track + ` AS tr WHERE tr.id = p.id) AS last_hash
			FROM page AS p
		),
		changed AS (
			SELECT id, current_hash, COALESCE(last_hash, 0) AS last_hash, last_hash IS NULL AS is_new
			FROM looked
			WHERE last_hash IS DISTINCT FROM current_hash
		)
		SELECT b.page_end, b.page_rows, c.id, COALESCE(c.current_hash, 0) AS current_hash,
			COALESCE(c.last_hash, 0) AS last_hash, COALESCE(c.is_new, false) AS is_new
		FROM (SELECT max(id)::bigint AS page_end, count(*) AS page_rows FROM page) AS b
		LEFT JOIN changed AS c ON true
		ORDER BY c.id`
}

// deletedQuery takes ONE page of track rows after the cursor and returns those whose id is gone from
// the source, plus where the page ended. The source is probed by key in a correlated subquery for the
// same reason as changedQuery: a NOT EXISTS becomes an anti-join that may hash the whole source per page.
func deletedQuery(tb *table) string {
	return `WITH page AS (
			SELECT tr.id, tr.last_hash
			FROM ` + tb.track + ` AS tr
			WHERE tr.id > ?::bigint
			ORDER BY tr.id
			LIMIT ?
		),
		gone AS (
			SELECT p.id, p.last_hash
			FROM page AS p
			WHERE (SELECT true FROM ` + tb.src + ` AS s WHERE s.` + tb.pkCol + ` = p.id) IS NULL
		)
		SELECT b.page_end, b.page_rows, g.id, COALESCE(g.last_hash, 0) AS last_hash
		FROM (SELECT max(id) AS page_end, count(*) AS page_rows FROM page) AS b
		LEFT JOIN gone AS g ON true
		ORDER BY g.id`
}
