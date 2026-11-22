//go:build raceaudit

// Concurrency audit for the EXPENSE METRICS' DAY RE-FOLD (metric_refold.go): it reads a team's day of `expense_records`
// and replaces the day's report rows, while ExpenseCreate / ExpenseAdjust may fold a new entry into the same rows. The
// fold takes no advisory key — its upsert holds ROW EXCLUSIVE on the report until it commits — so the re-fold takes the
// report in SHARE ROW EXCLUSIVE BEFORE it reads the records. A writer that reaches its fold inside the re-fold's gap
// must wait, then add on top; it must never commit in the gap, where the replace would overwrite its amount.
//
//	go test -tags raceaudit -p 1 -run "TestInterleave_MetricDayRefold|TestRace_MetricDayRefold" -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// refoldPause parks the re-fold right AFTER its read of the day's records — the gap between what it counted and what it
// writes. Only a context that carries it is parked.
type refoldPause struct {
	parked   chan struct{}
	release  chan struct{}
	parkOnce sync.Once
	letOnce  sync.Once
	seen     atomic.Int32
}

type refoldPauseKey struct{}

func newRefoldPause() *refoldPause {
	return &refoldPause{parked: make(chan struct{}), release: make(chan struct{})}
}

func (p *refoldPause) into(ctx context.Context) context.Context {
	return context.WithValue(ctx, refoldPauseKey{}, p)
}

func (p *refoldPause) hit(sql string) {
	if !strings.Contains(sql, "expense_records") || p.seen.Add(1) != 1 {
		return
	}

	p.parkOnce.Do(func() { close(p.parked) })
	<-p.release
}

func (p *refoldPause) waitParked(d time.Duration) bool {
	select {
	case <-p.parked:
		return true
	case <-time.After(d):
		return false
	}
}

func (p *refoldPause) let() {
	p.letOnce.Do(func() { close(p.release) })
}

var refoldPauseHookOnce sync.Once

// installRefoldPause hooks GORM's query callbacks AFTER the statement ran (a Find runs Query callbacks, and its SQL is
// built inside gorm:query).
func installRefoldPause(db *gorm.DB) {
	refoldPauseHookOnce.Do(func() {
		err := db.Callback().Query().After("gorm:query").Register("expense_refold:pause", func(tx *gorm.DB) {
			ctx := tx.Statement.Context
			if ctx == nil {
				return
			}

			p, ok := ctx.Value(refoldPauseKey{}).(*refoldPause)
			if ok && p != nil {
				p.hit(tx.Statement.SQL.String())
			}
		})
		if err != nil {
			panic(err)
		}
	})
}

// A FOLD IN THE GAP WAITS FOR THE REPLACE. The re-fold of the race day is parked after reading the records (one ad of
// 1.000.000); a new ad of 100.000,25 on the same day, same row, is created meanwhile. It must not commit while the
// re-fold is parked — it waits on the re-fold's lock — and once both finish the day's row equals its records:
// 1.100.000,25. Without the lock the create commits in the gap and the replace writes 1.000.000 over it.
func TestInterleave_MetricDayRefold_AFoldInTheGapWaitsForTheReplace(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	installRefoldPause(db)

	svc := newService(t, db)
	expense_v1.SetClock(svc, raceClock)

	team := raceTeam(t, db)

	_, err := raceCreate(svc, team, 1_000_000)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	pause := newRefoldPause()
	refolded := make(chan error, 1)

	go func() {
		_, err := svc.MetricDayRefold(pause.into(context.Background()), expense_v1.MetricDayRefoldInput{TeamID: team, Day: raceDay})
		refolded <- err
	}()

	if !pause.waitParked(5 * time.Second) {
		pause.let()
		t.Fatal("the re-fold never reached its read of the records")
	}

	created := make(chan error, 1)

	go func() {
		_, err := raceCreate(svc, team, 100_000.25)
		created <- err
	}()

	select {
	case err := <-created:
		pause.let()
		<-refolded
		t.Fatalf("the create committed inside the re-fold's gap (err %v) — its fold must wait for the re-fold's lock", err)
	case <-time.After(1500 * time.Millisecond):
	}

	pause.let()

	err = <-refolded
	if err != nil {
		t.Fatalf("re-fold: %v", err)
	}

	err = <-created
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reported, rows, recorded := theRow(t, db, team)
	if rows != 1 || !san_money.Equal(reported, recorded) || !san_money.Equal(reported, 1_100_000.25) {
		t.Fatalf("%d rows reading %v, records %v — want one row at 1.100.000,25", rows, reported, recorded)
	}
}

// MANY RE-FOLDS AND WRITES AT ONCE on one team's day: six re-folds beside ten creates and corrections — none fails, none
// deadlocks, and the day's report equals its records at the end.
func TestRace_MetricDayRefold_BesideTheWriters(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc := newService(t, db)
	expense_v1.SetClock(svc, raceClock)

	team := raceTeam(t, db)

	earlier := make([]uint64, 0, 5)

	for range 5 {
		id, err := raceCreate(svc, team, 1_000_000)
		if err != nil {
			t.Fatalf("seed: %v", err)
		}

		earlier = append(earlier, id)
	}

	res := h.Race(t, 16, func(i int) error {
		switch {
		case i%8 < 3:
			_, err := svc.MetricDayRefold(context.Background(), expense_v1.MetricDayRefoldInput{TeamID: team, Day: raceDay})

			return err
		case i%2 == 0:
			_, err := raceCreate(svc, team, 50_000.5)

			return err
		default:
			return raceCorrect(svc, team, earlier[i%5], -100_000)
		}
	})

	if res.Failed() != 0 {
		res.Report(t)
		t.Fatalf("%d of 16 failed", res.Failed())
	}

	reported, _, recorded := theRow(t, db, team)
	if !san_money.Equal(reported, recorded) {
		t.Fatalf("the report reads %v, the records %v", reported, recorded)
	}
}
