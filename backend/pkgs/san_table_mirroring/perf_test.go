//go:build perfaudit

package san_table_mirroring

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"
)

// TestPerf_TrackTable measures one table of 200.000 rows: the first run acked in batches (AckAll), a
// run with nothing changed, a run with 1% changed acked one by one (Ack), and a run with 1% deleted.
// It also reads the plans of both page queries, which must probe by key: a seq scan under a page makes
// a run cost a pass over the table PER PAGE instead of one pass in total.
func TestPerf_TrackTable(t *testing.T) {
	db, schema := scratch(t)

	const rows = 200000

	table := schema + ".rows"
	exec(t, db, `CREATE TABLE `+table+` (id bigint PRIMARY KEY, name text NOT NULL, amount numeric NOT NULL, at timestamptz NOT NULL)`)
	exec(t, db, `INSERT INTO `+table+` SELECT g, 'name '||g, g * 1.5, now() - g * interval '1 minute' FROM generate_series(1, ?) AS g`, rows)
	exec(t, db, `ANALYZE `+table)

	type row struct {
		ID     int64
		Name   string
		Amount float64
		At     time.Time
	}

	timed := func(label string, handler func(ctx context.Context, c Change[row]) error, flush func() error) int {
		start := time.Now()
		sent := 0

		err := TrackTable[row](context.Background(), db, table, func(ctx context.Context, c Change[row]) error {
			sent++

			return handler(ctx, c)
		})
		if err == nil && flush != nil {
			err = flush()
		}

		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}

		t.Logf("%-36s %7d sent in %v", label, sent, time.Since(start).Round(time.Millisecond))

		return sent
	}

	oneByOne := func(ctx context.Context, c Change[row]) error { return c.Ack(db) }

	var buffer []Change[row]

	batched := func(ctx context.Context, c Change[row]) error {
		buffer = append(buffer, c)
		if len(buffer) < 1000 {
			return nil
		}

		err := AckAll(db, buffer)
		buffer = buffer[:0]

		return err
	}
	flush := func() error {
		err := AckAll(db, buffer)
		buffer = buffer[:0]

		return err
	}

	if sent := timed("first run, AckAll per 1.000", batched, flush); sent != rows {
		t.Fatalf("first run sent %d, want %d", sent, rows)
	}

	exec(t, db, `ANALYZE `+schema+`_track.rows_track`)

	if sent := timed("nothing changed", oneByOne, nil); sent != 0 {
		t.Fatalf("nothing changed, but %d sent", sent)
	}

	exec(t, db, `UPDATE `+table+` SET name = name || '!' WHERE id % 100 = 0`)

	if sent := timed("1% changed, Ack one by one", oneByOne, nil); sent != rows/100 {
		t.Fatalf("1%% changed: %d sent, want %d", sent, rows/100)
	}

	exec(t, db, `DELETE FROM `+table+` WHERE id % 100 = 1`)

	if sent := timed("1% deleted, Ack one by one", oneByOne, nil); sent != rows/100 {
		t.Fatalf("1%% deleted: %d sent, want %d", sent, rows/100)
	}

	tb, err := resolveTable(db, table)
	if err != nil {
		t.Fatal(err)
	}

	for name, query := range map[string]string{"changedQuery": changedQuery(tb), "deletedQuery": deletedQuery(tb)} {
		var plan []string

		err = db.
			Raw(`EXPLAIN `+query, int64(math.MinInt64)+1, pageSize).
			Scan(&plan).
			Error
		if err != nil {
			t.Fatal(err)
		}

		joined := strings.Join(plan, "\n")
		t.Logf("%s plan:\n%s", name, joined)

		if strings.Contains(joined, "Seq Scan") {
			t.Errorf("%s scans a whole table under a page", name)
		}
	}
}
