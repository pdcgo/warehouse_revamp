// Package san_perf records what an RPC actually did to the database, so a performance audit is a
// measurement rather than an opinion.
//
// It is a GORM *session logger*, deliberately NOT a callback. `san_testdb` hands every test a
// session off one process-wide root connection, and callbacks registered with
// `db.Callback().Query().Register(...)` live on that shared root — one test's probe would record
// (and outlive into) every other test in the package. A session logger is carried by the cloned
// Config, so it reaches everything the handler derives from the wrapped db — `WithContext`,
// `Model`, `Transaction` — and nothing else.
//
// Usage, from a build-tagged `<rpc>_perf_test.go` beside the handler:
//
//	db, probe := san_perf.Wrap(san_testdb.DB(t))
//	san_perf.SeedRows(t, db, stockRows)   // not recorded, and ANALYZEs the table
//	svc := newService(db)
//
//	svc.StockList(ctx, warmupReq)         // pay for schema reflection + pool setup
//	probe.Reset()
//	svc.StockList(ctx, req)               // the measured call
//	probe.Report(t, "StockList")
package san_perf

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Query is one statement the handler issued.
type Query struct {
	SQL      string // already interpolated by GORM — safe to feed straight to EXPLAIN
	Rows     int64
	Duration time.Duration
	Err      error
}

// Probe collects the queries of whatever runs against the db it was attached to.
type Probe struct {
	mu      sync.Mutex
	queries []Query
	wall    time.Duration
}

// Wrap returns a session of db whose every statement is recorded, plus the probe recording them.
// The returned db is what you hand to the service constructor.
func Wrap(db *gorm.DB) (*gorm.DB, *Probe) {
	p := &Probe{}

	return db.Session(&gorm.Session{Logger: p}), p
}

// --- logger.Interface -------------------------------------------------------

func (p *Probe) LogMode(logger.LogLevel) logger.Interface { return p }

func (p *Probe) Info(context.Context, string, ...any)  {}
func (p *Probe) Warn(context.Context, string, ...any)  {}
func (p *Probe) Error(context.Context, string, ...any) {}

func (p *Probe) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	sql, rows := fc()

	p.mu.Lock()
	defer p.mu.Unlock()

	p.queries = append(p.queries, Query{
		SQL:      sql,
		Rows:     rows,
		Duration: time.Since(begin),
		Err:      err,
	})
}

// --- reading the measurement ------------------------------------------------

// Reset drops everything recorded so far. Call it after the warm-up call and after seeding, so the
// report covers only the measured call.
func (p *Probe) Reset() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.queries = nil
	p.wall = 0
}

// Queries returns a copy of what was recorded.
func (p *Probe) Queries() []Query {
	p.mu.Lock()
	defer p.mu.Unlock()

	return append([]Query(nil), p.queries...)
}

// Count is the number of statements. Run the same call at two page sizes and compare: if this moves
// with the row count, the handler has an N+1 and it is heavy whatever the absolute number is.
func (p *Probe) Count() int {
	p.mu.Lock()
	defer p.mu.Unlock()

	return len(p.queries)
}

// DBTotal is the summed query time. The gap between the caller's wall time and this is the
// non-database cost — mapping, proto encoding, in-Go loops.
func (p *Probe) DBTotal() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()

	var total time.Duration
	for _, q := range p.queries {
		total += q.Duration
	}

	return total
}

// Measure runs fn, records its wall time, and returns it alongside the db time spent inside it.
func (p *Probe) Measure(fn func()) (wall time.Duration, db time.Duration) {
	before := p.DBTotal()
	start := time.Now()

	fn()

	wall = time.Since(start)

	return wall, p.DBTotal() - before
}

// shape collapses a repeated query to its structure, so an N+1 shows up as one row with a count
// instead of fifty near-identical lines. It is deliberately crude — literals differ, structure does
// not — and is only ever used for GROUPING the report, never for reasoning about the SQL itself.
func shape(sql string) string {
	var b strings.Builder

	inQuote := false
	lastSpace := false

	for _, r := range sql {
		switch {
		case r == '\'':
			inQuote = !inQuote

			if inQuote {
				b.WriteString("'?")
			}
		case inQuote:
			// swallow the literal
		case r >= '0' && r <= '9':
			b.WriteRune('?')
		case r == ' ' || r == '\n' || r == '\t':
			if !lastSpace {
				b.WriteRune(' ')
			}
		default:
			b.WriteRune(r)
		}

		lastSpace = r == ' ' || r == '\n' || r == '\t'
	}

	return strings.TrimSpace(b.String())
}

type group struct {
	Shape string
	N     int
	Rows  int64
	Total time.Duration
	Worst string
}

// Report prints the markdown the audit doc is built from: one row per query SHAPE, the repeat count
// beside it, and the db/wall split. Output goes through t.Logf, so run the perf test with -v.
func (p *Probe) Report(t *testing.T, name string) {
	t.Helper()

	qs := p.Queries()

	byShape := map[string]*group{}
	order := []string{}

	for _, q := range qs {
		s := shape(q.SQL)

		g, ok := byShape[s]
		if !ok {
			g = &group{Shape: s, Worst: q.SQL}
			byShape[s] = g
			order = append(order, s)
		}

		g.N++
		g.Rows += q.Rows
		g.Total += q.Duration
	}

	sort.SliceStable(order, func(i, j int) bool {
		return byShape[order[i]].Total > byShape[order[j]].Total
	})

	var b strings.Builder

	fmt.Fprintf(&b, "\n### %s — %d queries, %s in db\n\n", name, len(qs), p.DBTotal().Round(time.Microsecond))
	fmt.Fprintf(&b, "| ×N | rows | total | each | query |\n|---|---|---|---|---|\n")

	for _, s := range order {
		g := byShape[s]

		each := g.Total
		if g.N > 0 {
			each = g.Total / time.Duration(g.N)
		}

		flag := ""
		if g.N > 1 {
			flag = " ⚠"
		}

		fmt.Fprintf(&b, "| %d%s | %d | %s | %s | `%s` |\n",
			g.N, flag, g.Rows,
			g.Total.Round(time.Microsecond),
			each.Round(time.Microsecond),
			truncate(g.Shape, 110),
		)
	}

	b.WriteString("\nFull SQL of the slowest shape (feed to san_perf.Explain):\n")

	if len(order) > 0 {
		fmt.Fprintf(&b, "%s\n", byShape[order[0]].Worst)
	}

	t.Log(b.String())
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}

	return s[:n] + "…"
}

// --- helpers ----------------------------------------------------------------

// Explain runs EXPLAIN (ANALYZE, BUFFERS) on the SAME transaction the test is using, and logs the
// plan.
//
// It has to be the same transaction: the seed rows live inside the per-test transaction that
// san_testdb rolls back, so an EXPLAIN issued from psql — or from any other connection — would plan
// against an EMPTY table and report a meaningless 0.02ms seq scan.
func Explain(t *testing.T, db *gorm.DB, sql string) string {
	t.Helper()

	var lines []string

	err := db.Session(&gorm.Session{Logger: logger.Discard}).
		Raw("EXPLAIN (ANALYZE, BUFFERS) " + sql).
		Scan(&lines).
		Error
	if err != nil {
		t.Fatalf("san_perf: explain: %v", err)
	}

	plan := strings.Join(lines, "\n")
	t.Logf("\nEXPLAIN (ANALYZE, BUFFERS)\n%s\n\n%s\n", truncate(sql, 300), plan)

	return plan
}

// SeedRows bulk-inserts rows and then ANALYZEs the table, without the probe recording any of it.
//
// The ANALYZE is not optional. Freshly inserted rows have no statistics, and inside a transaction
// autovacuum will never produce any — so the planner sizes every table at its default guess and
// picks a plan that has nothing to do with the one production would get. ANALYZE inside the
// transaction is visible to that transaction, which is exactly what the audit needs.
func SeedRows(t *testing.T, db *gorm.DB, rows any) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.CreateInBatches(rows, 1000).Error
	if err != nil {
		t.Fatalf("san_perf: seed: %v", err)
	}

	stmt := &gorm.Statement{DB: db}

	err = stmt.Parse(rows)
	if err != nil {
		t.Fatalf("san_perf: seed: resolving table: %v", err)
	}

	err = quiet.Exec("ANALYZE " + stmt.Table).Error
	if err != nil {
		t.Fatalf("san_perf: seed: analyze %s: %v", stmt.Table, err)
	}
}

// Median of the wall times of n runs. A single sample on a laptop with docker on it is noise.
func Median(ds []time.Duration) time.Duration {
	if len(ds) == 0 {
		return 0
	}

	cp := append([]time.Duration(nil), ds...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })

	return cp[len(cp)/2]
}
