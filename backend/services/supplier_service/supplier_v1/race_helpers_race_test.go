//go:build raceaudit

// Helpers for the supplier_service concurrency audit (the audit-sql skill). Every name carries a `race`
// prefix so it cannot collide with the rolling-back tests' helpers in setup_test.go.
//
// Build-tagged: san_race COMMITS through san_testdb.Pool, and must never run beside the tests that share
// one rolling-back transaction (two goroutines inside one transaction never block on each other's locks).
//
//	cd backend && go test -tags raceaudit -run 'TestRace_|TestInterleave_' -v ./services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// raceTables are the tables this audit writes, CHILDREN FIRST — san_race deletes them in this order.
var raceTables = []string{"supplier_channels", "suppliers"}

// raceHarness is a committing harness over the two supplier tables, with the pause hooks installed.
func raceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t, raceTables...)
	raceInstallPauseHooks(h.DB())

	return h
}

// raceService builds the real service over db — the pool, or one Interleave transaction (where the
// handler's own Transaction becomes a SAVEPOINT and its locks are held until that transaction ends).
func raceService(db *gorm.DB) *supplier_v1.Service {
	return supplier_v1.NewService(db, sellingTeams{selling: map[uint64]bool{sellingA: true, sellingB: true}}, nil)
}

// ── The pause hook ──────────────────────────────────────────────────────────────────────────────────
//
// A handler is one Go function, and an Interleave step runs it whole. To put ANOTHER transaction between two
// of its statements — between SupplierChannelCreate's FOR SHARE and its INSERT — the handler is parked by a
// GORM callback keyed on its context. Nothing in the handler changes: the callback fires only for a
// statement whose ctx carries a racePause, so every other caller is untouched.

type racePauseKey struct{}

// racePause parks the first statement of kind op ("create" | "query" | "update") on table, until let().
type racePause struct {
	op      string
	table   string
	once    sync.Once
	parked  chan struct{}
	release chan struct{}
}

func raceNewPause(op, table string) *racePause {
	return &racePause{op: op, table: table, parked: make(chan struct{}), release: make(chan struct{})}
}

// into returns ctx carrying this pause — pass it to the handler.
func (p *racePause) into(ctx context.Context) context.Context {
	return context.WithValue(ctx, racePauseKey{}, p)
}

func (p *racePause) hit(op, table string) {
	if op != p.op || table != p.table {
		return
	}

	p.once.Do(func() {
		close(p.parked)
		<-p.release
	})
}

// awaitParked waits until the handler sits at the pause point. It returns an error rather than failing the
// test, because Interleave steps run on their own goroutines.
func (p *racePause) awaitParked() error {
	select {
	case <-p.parked:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("the handler never reached the pause point")
	}
}

// let releases the parked handler. Call once.
func (p *racePause) let() {
	close(p.release)
}

var raceHooksOnce sync.Once

// raceInstallPauseHooks registers the pause callbacks once per process, before any concurrency starts.
func raceInstallPauseHooks(db *gorm.DB) {
	raceHooksOnce.Do(func() {
		hook := func(op string) func(*gorm.DB) {
			return func(tx *gorm.DB) {
				ctx := tx.Statement.Context
				if ctx == nil {
					return
				}

				p, ok := ctx.Value(racePauseKey{}).(*racePause)
				if ok && p != nil {
					p.hit(op, tx.Statement.Table)
				}
			}
		}

		for _, err := range []error{
			db.Callback().Create().Before("gorm:create").Register("race:pause_create", hook("create")),
			db.Callback().Query().Before("gorm:query").Register("race:pause_query", hook("query")),
			db.Callback().Update().Before("gorm:update").Register("race:pause_update", hook("update")),
		} {
			if err != nil {
				panic(err)
			}
		}
	})
}

// ── Inspection ──────────────────────────────────────────────────────────────────────────────────────

// raceWait is one blocked backend, the one it waits on, and what that holder is doing meanwhile.
type raceWait struct {
	san_race.Waiter
	HolderState string
}

// raceWaiters names the locks being waited on right now — call it while a Block step is parked.
func raceWaiters(db *gorm.DB) ([]raceWait, error) {
	ws, err := san_race.Waiters(db)
	if err != nil {
		return nil, err
	}

	out := make([]raceWait, 0, len(ws))

	for _, w := range ws {
		var state string

		err = db.Raw(`SELECT COALESCE(state, '') FROM pg_stat_activity WHERE pid = ?`, w.BlockedBy).Scan(&state).Error
		if err != nil {
			return nil, err
		}

		out = append(out, raceWait{Waiter: w, HolderState: state})
	}

	return out, nil
}

func raceLogWaiters(t *testing.T, ws []raceWait) {
	t.Helper()

	if len(ws) == 0 {
		t.Log("waiters: none")
		return
	}

	for _, w := range ws {
		t.Logf("waiter pid %d ← holder pid %d (holder is %q)\n  waiting: %s\n  holder's last: %s",
			w.BlockedPID, w.BlockedBy, w.HolderState, raceOneLine(w.Waiting), raceOneLine(w.Holding))
	}
}

func raceOneLine(s string) string {
	out := make([]rune, 0, len(s))
	space := false

	for _, r := range s {
		if r == '\n' || r == '\t' || r == ' ' || r == '\r' {
			if !space {
				out = append(out, ' ')
			}

			space = true

			continue
		}

		space = false

		out = append(out, r)
	}

	return string(out)
}

// raceCountChannels counts a supplier's stores, deleted ones included.
func raceCountChannels(t *testing.T, db *gorm.DB, supplierID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COUNT(*) FROM supplier_channels WHERE supplier_id = ?`, supplierID).Scan(&n).Error
	if err != nil {
		t.Fatalf("count channels: %v", err)
	}

	return n
}

func raceStr(s string) *string {
	return &s
}
