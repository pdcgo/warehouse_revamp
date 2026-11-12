//go:build raceaudit

// Concurrency audit for a SUPPLIER'S DAY RE-FOLD (a-wrong-day-is-refolded-from-the-log, for
// supplier_product_daily_reports and supplier_sale_daily_reports — the audit-sql skill).
//
// WHY. The re-fold REPLACES rows the folds INCREMENT while the folds keep running: an event in flight for that very day,
// a dead-lettered one redelivered at the same moment, a second operator running the same command. Neither fold takes an
// advisory lock — each claims, then upserts (ROW EXCLUSIVE on its report) — so the re-fold claims first and then takes
// the report in SHARE ROW EXCLUSIVE. Two bugs are possible and this file proves them absent:
//
//  1. A DOUBLE COUNT, or a LOST one: an event the re-fold counted folded again on top, or one it left to the fold
//     overwritten by its replace.
//
//  2. A DEADLOCK between the re-folds' claims (event ids, order rows) and table lock and the folds' (40P01).
//
//     go test -tags raceaudit -p 1 -run 'TestRace_DayRefold' -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// raceToday is today's Jakarta day, and two instants on it: two hours ago (a lost event) and ten minutes ago (one in
// flight) — or a skip within two hours of Jakarta midnight, where a lost event of today cannot be two hours old.
func raceToday(t *testing.T) (string, time.Time, time.Time) {
	t.Helper()

	zone := time.FixedZone("WIB", 7*60*60)
	now := time.Now()
	today := now.In(zone).Format("2006-01-02")
	start, _ := time.ParseInLocation("2006-01-02", today, zone)

	lostAt, youngAt := now.Add(-2*time.Hour), now.Add(-10*time.Minute)
	if lostAt.Before(start) {
		t.Skip("within two hours of Jakarta midnight a lost event of today cannot be two hours old — run it later")
	}

	return today, lostAt, youngAt
}

// ⚠ RESTOCK: per round the day gains one folded accept, two LOST ones and two IN FLIGHT, one good unit each. At once:
// two re-folds of the supplier's day, the folds of the two in flight, a redelivery of each lost one. The re-folds sleep
// round%10 ms and the folds (round×3)%7 ms, so both orderings are hit. The day ends with every accept once, one claim
// each, and nobody deadlocks.
func TestRace_DayRefold_Restock_AFoldRacingItCountsEveryAcceptOnce(t *testing.T) {
	h := figHarness(t)
	figReset(t, h.DB())
	t.Cleanup(func() { figReset(t, h.DB()) })

	today, lostAt, youngAt := raceToday(t)
	svc := raceService(h.DB())
	ctx := context.Background()

	log := refoldLog{accepts: map[string][]*eventsv1.Event{}}
	next := uint64(7_000)

	acceptAt := func(at time.Time) *eventsv1.Event {
		next++
		event := accept(next, sellingA, figSupplier, today, line{product: figProductA, ordered: 1, total: 1_000, accepted: 1})
		event.OccurredAt = timestamppb.New(at)
		log.accepts[today] = append(log.accepts[today], event)

		return event
	}

	const rounds = 10

	countedYoung := 0

	for round := range rounds {
		fold(t, svc, acceptAt(lostAt))

		lost := []*eventsv1.Event{acceptAt(lostAt), acceptAt(lostAt)}
		young := []*eventsv1.Event{acceptAt(youngAt), acceptAt(youngAt)}

		results := make([]supplier_v1.DayRefoldResult, 2)

		res := h.Race(t, 6, func(i int) error {
			switch i {
			case 0, 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				var err error

				results[i], err = svc.DayRefold(ctx, supplier_v1.DayRefoldInput{
					Report: supplier_v1.ReportRestockDaily, SupplierID: figSupplier, Day: today,
				}, log)

				return err
			case 2, 3:
				// The folds start late too, on another rhythm, so they land inside the re-folds' work as well as before it.
				time.Sleep(time.Duration((round*3)%7) * time.Millisecond)

				return svc.FoldHandler()(ctx, young[i-2])
			default:
				return svc.FoldHandler()(ctx, lost[i-4])
			}
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 6 callers failed — none should, a deadlock included", round, res.Failed())
		}

		for _, r := range results {
			if r.InFlight == 0 {
				countedYoung++
			}
		}

		want := int64(5 * (round + 1))
		if got := figureRow(t, h.DB(), today, figSupplier, figProductA, sellingA); got.RestockCount != want {
			t.Fatalf("round %d: the day counts %d units, want %d — every accept once", round, got.RestockCount, want)
		}

		var claims int64

		err := h.DB().Raw(`SELECT count(*) FROM supplier_event_logs WHERE day = CAST(? AS date)`, today).Scan(&claims).Error
		if err != nil || claims != want {
			t.Fatalf("round %d: %d claims (err %v), want one per accept", round, claims, err)
		}
	}

	t.Logf("of %d re-folds, %d found the in-flight accepts already folded; the rest left them to the fold", 2*rounds, countedYoung)
}

// ⚠ PENJUALAN: per round the day gains one folded order, two LOST placements and two IN FLIGHT, 8 Kaos from Sumber
// each. At once: two re-folds of Sumber's day, the folds of the two in flight, a redelivery of each lost one. The day
// ends with every order once, one placed_day each, and nobody deadlocks.
func TestRace_DayRefold_Sale_AFoldRacingItCountsEveryOrderOnce(t *testing.T) {
	h := san_race.New(t, salesRaceTables...)

	today, lostAt, youngAt := raceToday(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	svc := salesService(h.DB(), goods)
	ctx := context.Background()

	log := refoldLog{sales: map[string][]*eventsv1.Event{}}
	next := uint64(70_000)

	placedAt := func(at time.Time) *eventsv1.Event {
		next++
		goods.takes[next] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 8}}
		event := salePlaced(next, next, at, 80_000, saleLine(salKaos, 8, 80_000))
		log.sales[today] = append(log.sales[today], event)

		return event
	}

	const rounds = 10

	for round := range rounds {
		salesFold(t, svc, placedAt(lostAt))

		lost := []*eventsv1.Event{placedAt(lostAt), placedAt(lostAt)}
		young := []*eventsv1.Event{placedAt(youngAt), placedAt(youngAt)}

		res := h.Race(t, 6, func(i int) error {
			switch i {
			case 0, 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				_, err := svc.DayRefold(ctx, supplier_v1.DayRefoldInput{
					Report: supplier_v1.ReportSaleDaily, SupplierID: salSumber, Day: today,
				}, log)

				return err
			case 2, 3:
				time.Sleep(time.Duration((round*3)%7) * time.Millisecond)

				return svc.SalesFoldHandler()(ctx, young[i-2])
			default:
				return svc.SalesFoldHandler()(ctx, lost[i-4])
			}
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 6 callers failed — none should, a deadlock included", round, res.Failed())
		}

		units, value, _ := saleRow(t, h.DB(), today, salSumber, salKaos, sellingA)
		if want := int64(8 * 5 * (round + 1)); units != want || !near(value, float64(want)*10_000) {
			t.Fatalf("round %d: the day = %d units · Rp %v, want %d — every order once", round, units, value, want)
		}

		var placed int64

		err := h.DB().Raw(`SELECT count(*) FROM supplier_sale_orders WHERE placed_day = CAST(? AS date)`, today).Scan(&placed).Error
		if err != nil || placed != int64(5*(round+1)) {
			t.Fatalf("round %d: %d placements claimed (err %v), want one per order", round, placed, err)
		}
	}
}

// ⚠ THE INTERLEAVING THE LOCK IS FOR, forced: the re-fold has counted the day's claims and is parked just before it
// reads the stored rows to replace them; a fold of an event in flight runs now. Under the re-fold's SHARE ROW EXCLUSIVE
// lock the fold's upsert must WAIT, and add its unit after the replace. Without the lock it commits inside the gap, the
// re-fold reads its unit in the stored row but not in the claims it already counted, and the replace erases it — the
// day ends one short. Proven both ways: this test fails with the LOCK TABLE line removed.
func TestInterleave_DayRefold_AFoldInTheGapWaitsForTheReplace(t *testing.T) {
	cases := []struct {
		name   string
		report string
		stored string
		tables []string
	}{
		{"restock", supplier_v1.ReportRestockDaily, "shipping_broken_count, shipping_broken_valuation\nFROM supplier_product_daily_reports", figTables},
		{"sale", supplier_v1.ReportSaleDaily, "SELECT product_id, team_id, sales_count, sales_value FROM supplier_sale_daily_reports", salesRaceTables},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := san_race.New(t, c.tables...)
			refoldInstallRowPause(h.DB())
			figResetMetadata(t, h.DB())

			today, lostAt, youngAt := raceToday(t)
			goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
			svc := salesService(h.DB(), goods)
			ctx := context.Background()

			var lost, young *eventsv1.Event

			var supplier uint64

			var foldYoung func() error

			var units func() int64

			log := refoldLog{accepts: map[string][]*eventsv1.Event{}, sales: map[string][]*eventsv1.Event{}}

			if c.report == supplier_v1.ReportRestockDaily {
				supplier = figSupplier
				lost = accept(7_801, sellingA, figSupplier, today, line{product: figProductA, ordered: 1, total: 1_000, accepted: 1})
				lost.OccurredAt = timestamppb.New(lostAt)
				young = accept(7_802, sellingA, figSupplier, today, line{product: figProductA, ordered: 1, total: 1_000, accepted: 1})
				young.OccurredAt = timestamppb.New(youngAt)
				log.accepts[today] = []*eventsv1.Event{lost, young}
				foldYoung = func() error { return svc.FoldHandler()(ctx, young) }
				units = func() int64 { return figureRow(t, h.DB(), today, figSupplier, figProductA, sellingA).RestockCount }
			} else {
				supplier = salSumber

				for _, id := range []uint64{78_001, 78_002} {
					goods.takes[id] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 1}}
				}

				lost = salePlaced(78_001, 78_001, lostAt, 10_000, saleLine(salKaos, 1, 10_000))
				young = salePlaced(78_002, 78_002, youngAt, 10_000, saleLine(salKaos, 1, 10_000))
				log.sales[today] = []*eventsv1.Event{lost, young}
				foldYoung = func() error { return svc.SalesFoldHandler()(ctx, young) }
				units = func() int64 {
					n, _, _ := saleRow(t, h.DB(), today, salSumber, salKaos, sellingA)

					return n
				}
			}

			pause := figNewPause(c.stored, 1)
			refolded := make(chan error, 1)

			go func() {
				_, err := svc.DayRefold(pause.into(ctx), supplier_v1.DayRefoldInput{Report: c.report, SupplierID: supplier, Day: today}, log)
				refolded <- err
			}()

			if !pause.waitParked(5 * time.Second) {
				pause.let()
				t.Fatal("the re-fold never reached its read of the stored rows")
			}

			folded := make(chan error, 1)

			go func() { folded <- foldYoung() }()

			select {
			case err := <-folded:
				pause.let()
				<-refolded
				t.Fatalf("the fold committed inside the re-fold's gap (err %v) — it must wait for the re-fold's lock", err)
			case <-time.After(300 * time.Millisecond):
			}

			pause.let()

			err := <-refolded
			if err != nil {
				t.Fatalf("re-fold: %v", err)
			}

			err = <-folded
			if err != nil {
				t.Fatalf("fold: %v", err)
			}

			if got := units(); got != 2 {
				t.Fatalf("the day counts %d units, want 2 — the lost event the re-fold claimed and the one the fold added after it", got)
			}
		})
	}
}

var refoldRowHookOnce sync.Once

// refoldInstallRowPause is figInstallRawPause for READS: a `Raw(…).Scan` runs GORM's Row callbacks, not its Raw ones, so
// parking the re-fold before a read needs this hook too. Keyed on the same figPause in the ctx — every other caller is
// untouched.
func refoldInstallRowPause(db *gorm.DB) {
	refoldRowHookOnce.Do(func() {
		err := db.Callback().Row().Before("gorm:row").Register("refold:pause_row", func(tx *gorm.DB) {
			ctx := tx.Statement.Context
			if ctx == nil {
				return
			}

			p, ok := ctx.Value(figPauseKey{}).(*figPause)
			if ok && p != nil {
				p.hit(tx.Statement.SQL.String())
			}
		})
		if err != nil {
			panic(err)
		}
	})
}
