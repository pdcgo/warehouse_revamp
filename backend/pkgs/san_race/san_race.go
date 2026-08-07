// Package san_race proves — or disproves — a concurrency bug against a real Postgres, so a
// race/deadlock audit is a demonstration rather than a code-reading opinion.
//
// It exists because the ordinary test harness structurally CANNOT find these bugs. `san_testdb.DB`
// hands every test one transaction that rolls back; two goroutines sharing it never block on each
// other's row locks, never serialize, and never deadlock. A lost update that happens every day in
// production is invisible there — the test passes and proves nothing. So san_race takes
// `san_testdb.Pool` (committing, real connections) and cleans up by deleting what it wrote.
//
// Two shapes, and they answer different questions:
//
//	Race       N callers hit the same RPC at once → does the total come out right? (finds lost
//	           updates, phantom inserts, deadlock under load)
//	Interleave two transactions run in an EXACT step order you write down → does step B4 block
//	           until A commits, or does it read stale and overwrite? (finds check-then-act)
//
// Race is the honest smoke test; Interleave is the proof. A race that "passed" 8 goroutines may
// simply have not hit the window — only a written-down interleaving shows the bug is impossible.
//
// Usage, from a build-tagged `<rpc>_race_test.go` beside the handler:
//
//	h := san_race.New(t, "stock_movements", "stock_levels")   // deleted before and after
//	seed(h.DB())
//	res := h.Race(t, 8, func(i int) error {
//		_, err := svc.StockPick(ctx, connect.NewRequest(pickOne))
//		return err
//	})
//	res.Report(t)
package san_race

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

const (
	// lockTimeout turns a HANG into a FAILURE WITH EVIDENCE. Without it a test that blocks on a row
	// lock hangs until `go test` kills the whole package after 10 minutes, and the panic dump names
	// the barrier rather than the query — which tells you nothing about which lock.
	lockTimeout = "2s"

	// statementTimeout is the backstop for a query that is slow rather than blocked.
	statementTimeout = "10s"

	// blockGrace is how long a Block step is given to NOT return before it counts as blocked. It has
	// to sit above scheduler noise and below lockTimeout, or a step that was merely slow to start
	// reads as blocked.
	blockGrace = 300 * time.Millisecond

	// joinTimeout bounds the final wait on a still-outstanding step.
	joinTimeout = 30 * time.Second
)

// Kind is what an error MEANS to a concurrency audit. Postgres says these things in SQLSTATE codes,
// and the difference between them is the whole finding: 40P01 is a lock-ordering bug in our code,
// 23505 is usually the database correctly refusing a double-insert, and a nil error where you
// expected one of them is the worst outcome of all — the write silently went through.
type Kind string

const (
	None             Kind = "ok"
	Deadlock         Kind = "deadlock"          // 40P01 — two transactions took locks in opposite orders
	Serialization    Kind = "serialization"     // 40001 — SERIALIZABLE/REPEATABLE READ abort; retryable
	LockTimeout      Kind = "lock timeout"      // 55P03 — waited past lock_timeout for a row lock
	StatementTimeout Kind = "statement timeout" // 57014
	UniqueViolation  Kind = "unique violation"  // 23505 — often the constraint doing its job
	CheckViolation   Kind = "check violation"   // 23514 — e.g. a stock level driven negative
	ForeignKey       Kind = "fk violation"      // 23503
	Blocked          Kind = "blocked"           // did not return within blockGrace — waiting on a lock
	Other            Kind = "error"
)

// Classify maps an error to its Kind. It reads the SQLSTATE, never the message text — GORM wraps,
// Connect wraps again, and message matching breaks the first time a wrapper is added.
func Classify(err error) Kind {
	if err == nil {
		return None
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "40P01":
			return Deadlock
		case "40001":
			return Serialization
		case "55P03":
			return LockTimeout
		case "57014":
			return StatementTimeout
		case "23505":
			return UniqueViolation
		case "23514":
			return CheckViolation
		case "23503":
			return ForeignKey
		}

		return Other
	}

	// GORM's TranslateError replaces some driver errors with its own sentinels, losing the
	// SQLSTATE. These are the ones that matter to an audit.
	switch {
	case errors.Is(err, gorm.ErrDuplicatedKey):
		return UniqueViolation
	case errors.Is(err, gorm.ErrForeignKeyViolated):
		return ForeignKey
	case errors.Is(err, gorm.ErrCheckConstraintViolated):
		return CheckViolation
	}

	return Other
}

// Harness owns the committing pool and the cleanup contract.
type Harness struct {
	db     *gorm.DB
	tables []string
}

// New returns a harness over the shared test database, deleting `tables` before the test and again
// after it — in the order given, so list CHILD tables before their parents.
//
// ⚠ Nothing here rolls back. Every race test must be build-tagged `//go:build raceaudit` so it
// never runs inside `go test ./...`: package tests run in parallel against one `warehouse_test`,
// and a DELETE from a table another package is mid-test on is a flake generator.
//
// Skips (via san_testdb) when no Postgres is reachable.
func New(t *testing.T, tables ...string) *Harness {
	t.Helper()

	h := &Harness{db: san_testdb.Pool(t), tables: tables}

	h.clean(t, true)
	t.Cleanup(func() { h.clean(t, false) })

	return h
}

// DB is the committing pool — use it to seed, and to assert the final state after a race.
func (h *Harness) DB() *gorm.DB {
	return h.db
}

func (h *Harness) clean(t *testing.T, fatal bool) {
	t.Helper()

	for _, tbl := range h.tables {
		err := h.db.Exec(`DELETE FROM ` + tbl).Error
		if err == nil {
			continue
		}

		if fatal {
			t.Fatalf("san_race: cleaning %s: %v", tbl, err)
		}

		t.Errorf("san_race: cleaning %s after the test: %v", tbl, err)
	}
}

// --- Race -------------------------------------------------------------------

// Outcome is what one racing caller got back.
type Outcome struct {
	I    int
	Err  error
	Kind Kind
	Wall time.Duration
}

// Results is the whole race.
type Results struct {
	Name     string
	N        int
	Wall     time.Duration
	Outcomes []Outcome
}

// Race runs fn in n goroutines released SIMULTANEOUSLY and collects what each one got.
//
// The barrier is the point. Spawning n goroutines and letting them start as they are scheduled
// gives them a good chance of running one after another, which is exactly the case that has no
// bug in it — so the test passes and the race stays in production. Every goroutine parks on the
// same channel and they are woken by one close.
//
// fn takes only its index: the caller closes over the service, and the service's own pool hands
// each goroutine its own connection. For raw SQL, close over h.DB() and open your own transaction.
func (h *Harness) Race(t *testing.T, n int, fn func(i int) error) Results {
	t.Helper()

	var (
		ready sync.WaitGroup
		done  sync.WaitGroup
		start = make(chan struct{})
	)

	out := make([]Outcome, n)

	ready.Add(n)
	done.Add(n)

	for i := range n {
		go func() {
			defer done.Done()

			ready.Done()
			<-start

			at := time.Now()
			err := fn(i)

			out[i] = Outcome{I: i, Err: err, Kind: Classify(err), Wall: time.Since(at)}
		}()
	}

	ready.Wait()

	at := time.Now()
	close(start)
	done.Wait()

	return Results{N: n, Wall: time.Since(at), Outcomes: out}
}

// Count returns how many callers ended in kind k.
func (r Results) Count(k Kind) int {
	n := 0

	for _, o := range r.Outcomes {
		if o.Kind == k {
			n++
		}
	}

	return n
}

// Failed is how many callers got any error at all.
func (r Results) Failed() int {
	return r.N - r.Count(None)
}

// Report logs the outcome breakdown as a markdown table, ready to paste into the audit.
func (r Results) Report(t *testing.T) {
	t.Helper()

	counts := map[Kind]int{}
	order := []Kind{}

	for _, o := range r.Outcomes {
		if _, seen := counts[o.Kind]; !seen {
			order = append(order, o.Kind)
		}

		counts[o.Kind]++
	}

	var b strings.Builder

	fmt.Fprintf(&b, "\nrace ×%d — wall %v\n\n", r.N, r.Wall.Round(time.Millisecond))
	b.WriteString("| outcome | n | example |\n| --- | --- | --- |\n")

	for _, k := range order {
		example := ""

		for _, o := range r.Outcomes {
			if o.Kind == k && o.Err != nil {
				example = truncate(o.Err.Error(), 90)
				break
			}
		}

		fmt.Fprintf(&b, "| %s | %d | %s |\n", k, counts[k], example)
	}

	t.Log(b.String())
}

// --- Interleave -------------------------------------------------------------

// Step is one statement in a written-down schedule. Tx is a label ("A", "B") — each distinct label
// gets its own connection and its own transaction.
type Step struct {
	Tx    string
	Name  string
	Fn    func(tx *gorm.DB) error
	block bool
	end   bool
}

// Do is a step expected to return promptly.
func Do(tx, name string, fn func(*gorm.DB) error) Step {
	return Step{Tx: tx, Name: name, Fn: fn}
}

// Block is a step expected to BLOCK on a lock held by another transaction. The schedule starts it,
// confirms it has not returned, and moves on to the step that releases it — usually the other
// transaction's commit.
//
// A Block step that returns immediately is the finding: the lock you thought was held is not.
func Block(tx, name string, fn func(*gorm.DB) error) Step {
	return Step{Tx: tx, Name: name, Fn: fn, block: true}
}

// Commit ends a transaction successfully.
func Commit(tx string) Step {
	return Step{Tx: tx, Name: "COMMIT", end: true, Fn: func(db *gorm.DB) error {
		return db.Commit().Error
	}}
}

// Rollback ends a transaction, discarding it.
func Rollback(tx string) Step {
	return Step{Tx: tx, Name: "ROLLBACK", end: true, Fn: func(db *gorm.DB) error {
		return db.Rollback().Error
	}}
}

// StepResult is what a step did.
type StepResult struct {
	Step

	Err      error
	Kind     Kind
	Wall     time.Duration
	Blocked  bool // did not return within blockGrace
	Released bool // was blocked, then completed once the other transaction ended
}

// Schedule is the executed interleaving.
type Schedule struct {
	Steps []StepResult
}

// Get returns the result of the step with this name (the first, if repeated).
func (s Schedule) Get(name string) StepResult {
	for _, r := range s.Steps {
		if r.Name == name {
			return r
		}
	}

	return StepResult{}
}

// Report logs the schedule as a markdown table.
func (s Schedule) Report(t *testing.T) {
	t.Helper()

	var b strings.Builder

	b.WriteString("\ninterleaving\n\n| # | tx | step | took | outcome |\n| --- | --- | --- | --- | --- |\n")

	for i, r := range s.Steps {
		outcome := string(r.Kind)

		switch {
		case r.Blocked && r.Released:
			outcome = "⏸ blocked, released on the other commit → " + outcome
		case r.Blocked:
			outcome = "⏸ blocked → " + outcome
		case r.block:
			outcome = "⚠ EXPECTED TO BLOCK, RETURNED AT ONCE → " + outcome
		}

		if r.Err != nil {
			outcome += ": " + truncate(r.Err.Error(), 70)
		}

		fmt.Fprintf(&b, "| %d | %s | %s | %v | %s |\n",
			i+1, r.Tx, r.Name, r.Wall.Round(time.Millisecond), outcome)
	}

	t.Log(b.String())
}

type pendingStep struct {
	idx  int
	fn   func(tx *gorm.DB) error
	at   time.Time
	err  error
	wall time.Duration
	done chan struct{}
}

type runner struct {
	tx      *gorm.DB
	steps   chan *pendingStep
	pending *pendingStep
	ended   bool
}

// Interleave runs the steps in EXACTLY the order given, each transaction on its own connection.
//
// This is the proof half of the skill. A Race can miss a window; a schedule cannot — it forces the
// interleaving that the bug needs, so a passing Interleave says the bug is impossible rather than
// unlucky.
//
// Every transaction gets lock_timeout and statement_timeout set, so a step that waits forever fails
// with a SQLSTATE instead of hanging the package.
func (h *Harness) Interleave(t *testing.T, steps ...Step) Schedule {
	t.Helper()

	runners := map[string]*runner{}
	results := make([]StepResult, len(steps))

	defer func() {
		for _, r := range runners {
			close(r.steps)

			if !r.ended {
				r.tx.Rollback()
			}
		}
	}()

	get := func(name string) *runner {
		r, ok := runners[name]
		if ok {
			return r
		}

		tx := h.db.Begin()
		if tx.Error != nil {
			t.Fatalf("san_race: begin %s: %v", name, tx.Error)
		}

		for _, stmt := range []string{
			`SET LOCAL lock_timeout = '` + lockTimeout + `'`,
			`SET LOCAL statement_timeout = '` + statementTimeout + `'`,
		} {
			err := tx.Exec(stmt).Error
			if err != nil {
				t.Fatalf("san_race: %s on %s: %v", stmt, name, err)
			}
		}

		r = &runner{tx: tx, steps: make(chan *pendingStep)}

		go func() {
			for ps := range r.steps {
				ps.at = time.Now()
				ps.err = ps.fn(r.tx)
				ps.wall = time.Since(ps.at)

				close(ps.done)
			}
		}()

		runners[name] = r

		return r
	}

	// join waits for a runner's outstanding step and folds its real outcome into the results.
	join := func(r *runner, wait time.Duration) {
		if r.pending == nil {
			return
		}

		ps := r.pending

		select {
		case <-ps.done:
		case <-time.After(wait):
			t.Fatalf("san_race: step %q never returned after %v — it is stuck on a lock nothing "+
				"in this schedule releases", results[ps.idx].Name, wait)
		}

		r.pending = nil

		res := &results[ps.idx]
		res.Err = ps.err
		res.Kind = Classify(ps.err)
		res.Wall = ps.wall
		res.Released = res.Blocked
	}

	for i, step := range steps {
		results[i] = StepResult{Step: step}

		r := get(step.Tx)

		// A transaction that is blocked cannot issue its next statement — that is true of a real
		// transaction too, so wait it out rather than pretending otherwise.
		join(r, joinTimeout)

		ps := &pendingStep{idx: i, fn: step.Fn, done: make(chan struct{})}
		r.steps <- ps

		if step.block {
			select {
			case <-ps.done:
				// It did NOT block. Record it as it happened — Report flags the mismatch.
				results[i].Err = ps.err
				results[i].Kind = Classify(ps.err)
				results[i].Wall = ps.wall
			case <-time.After(blockGrace):
				results[i].Blocked = true
				results[i].Kind = Blocked
				r.pending = ps
			}

			continue
		}

		select {
		case <-ps.done:
			results[i].Err = ps.err
			results[i].Kind = Classify(ps.err)
			results[i].Wall = ps.wall
		case <-time.After(joinTimeout):
			t.Fatalf("san_race: step %q blocked but was not declared with Block() — %v",
				step.Name, joinTimeout)
		}

		if step.end {
			r.ended = true
		}
	}

	for _, r := range runners {
		join(r, joinTimeout)
	}

	return Schedule{Steps: results}
}

// --- Inspection -------------------------------------------------------------

// Waiter is one blocked backend and the one holding what it wants.
type Waiter struct {
	BlockedPID int    `gorm:"column:blocked_pid"`
	BlockedBy  int    `gorm:"column:blocking_pid"`
	Waiting    string `gorm:"column:waiting"`
	Holding    string `gorm:"column:holding"`
}

// Waiters reads pg_locks for who is currently waiting on whom. Call it from another goroutine
// while a Block step is parked — it names the lock, which the error message never does.
func Waiters(db *gorm.DB) ([]Waiter, error) {
	var out []Waiter

	err := db.Raw(`
		SELECT w.pid                              AS blocked_pid,
		       b.pid                              AS blocking_pid,
		       COALESCE(w.query, '')              AS waiting,
		       COALESCE(b.query, '')              AS holding
		FROM pg_stat_activity w
		JOIN LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid) ON TRUE
		JOIN pg_stat_activity b ON b.pid = bp.pid
		WHERE cardinality(pg_blocking_pids(w.pid)) > 0`).Scan(&out).Error

	return out, err
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}

	return s[:n] + "…"
}
