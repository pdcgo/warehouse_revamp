//go:build raceaudit

package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE REPORTS' WAREHOUSE UNDER CONCURRENCY (the-supplier-reports-carry-the-warehouse,
// audits/services/supplier_service/concurrency/lock-order.md): the warehouse is the LAST column of both report keys and
// is one per event (an accept's receiving warehouse, an order's take), so the folds keep their one lock order; and the
// backfill's part re-filing meets a live cancel of the same order on the order's row lock.
//
//	go test -tags raceaudit -p 1 -run 'TestRace_Warehouse' -v ./backend/services/supplier_service/supplier_v1/

// Four accepts of one day, team and supplier — two received at A, two at B, each pair naming the products in opposite
// orders — folded at once, round after round: never a deadlock, and each warehouse's rows hold exactly its two accepts.
func TestRace_Warehouse_AcceptsAtTwoWarehousesOneDayNeverDeadlock(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()
	day := jakartaDay(2)

	products := []uint64{101, 102, 103, 104}

	const rounds = 20

	deadlocks := 0

	for round := range rounds {
		figReset(t, h.DB())

		fwd := make([]line, 0, len(products))
		rev := make([]line, 0, len(products))

		for i := range products {
			fwd = append(fwd, line{product: products[i], ordered: 1, total: 1_000, accepted: 1})
			rev = append(rev, line{product: products[len(products)-1-i], ordered: 1, total: 1_000, accepted: 1})
		}

		base := uint64(5_000 + 4*round)
		events := []*eventsv1.Event{
			inWarehouse(accept(base, sellingA, figSupplier, day, fwd...), whA),
			inWarehouse(accept(base+1, sellingA, figSupplier, day, rev...), whA),
			inWarehouse(accept(base+2, sellingA, figSupplier, day, fwd...), whB),
			inWarehouse(accept(base+3, sellingA, figSupplier, day, rev...), whB),
		}

		res := h.Race(t, len(events), func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		deadlocks += res.Count(san_race.Deadlock)

		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: %d folds failed (%d deadlocks)", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		rows := restockRows(t, h.DB())
		if len(rows) != 2*len(products) {
			t.Fatalf("round %d: %d rows, want one per product per warehouse", round, len(rows))
		}

		for _, p := range products {
			for _, w := range []uint64{whA, whB} {
				want := figAdd(figZero, line{product: p, ordered: 1, total: 1_000, accepted: 2})
				if got := rows[rowKey(day, figSupplier, p, sellingA, w)]; got != want {
					t.Fatalf("round %d, product %d, warehouse %d: %+v, want %+v", round, p, w, got, want)
				}
			}
		}
	}

	t.Logf("%d rounds of 4 folds over two warehouses: %d deadlocks", rounds, deadlocks)
}

// Eight orders of one day taken from two warehouses, their parts in opposite orders, placed at once: never a deadlock,
// and each warehouse's Penjualan holds exactly its four orders.
func TestRace_Warehouse_SalesFromTwoWarehousesOneDay(t *testing.T) {
	h := san_race.New(t, salesRaceTables...)

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}

	for i := range 8 {
		w := whA
		if i%2 == 1 {
			w = whB
		}

		parts := []supplier_v1.SaleTakePart{
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: w, Units: 1},
			{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, WarehouseID: w, Units: 1},
		}
		if i%4 >= 2 {
			parts[0], parts[1] = parts[1], parts[0]
		}

		goods.takes[uint64(9_200+i)] = parts
	}

	svc := salesService(h.DB(), goods)

	res := h.Race(t, 8, func(i int) error {
		order := uint64(9_200 + i)

		return svc.SalesFoldHandler()(t.Context(), salePlaced(order, order, wib("2026-10-09", "10:00"), 20_000,
			saleLine(salKaos, 1, 10_000), saleLine(salCelana, 1, 10_000)))
	})
	res.Report(t)

	if res.Count(san_race.Deadlock) > 0 || res.Failed() > 0 {
		t.Fatalf("%d failed (%d deadlocks)", res.Failed(), res.Count(san_race.Deadlock))
	}

	sameSaleRows(t, "two warehouses", saleRows(t, h.DB()), map[string]saleFigure{
		rowKey("2026-10-09", salSumber, salKaos, sellingA, whA):  {count: 4, value: 40_000},
		rowKey("2026-10-09", salSumber, salKaos, sellingA, whB):  {count: 4, value: 40_000},
		rowKey("2026-10-09", salSinar, salCelana, sellingB, whA): {count: 4, value: 40_000},
		rowKey("2026-10-09", salSinar, salCelana, sellingB, whB): {count: 4, value: 40_000},
	})
}

// The backfill re-filing an order's parts WHILE that order's cancel arrives: they meet on the order's row lock, so the
// cancel takes back either the unfiled parts (warehouse 0) or the filed ones — never half of each — and after the
// day re-folds every day sums to exactly what it should, with no row left under no warehouse.
func TestRace_Warehouse_BackfillBesideALiveCancel(t *testing.T) {
	h := san_race.New(t, append(salesRaceTables, "supplier_event_logs")...)
	ctx := context.Background()

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	svc := salesService(h.DB(), goods)

	const rounds = 10

	filedFirst := 0

	for round := range rounds {
		for _, table := range salesRaceTables {
			err := h.DB().Exec(`DELETE FROM ` + table).Error
			if err != nil {
				t.Fatal(err)
			}
		}

		order := uint64(9_300 + round)
		goods.takes[order] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whB, Units: 3}}

		placed := inWarehouse(salePlaced(order, order, wib("2026-10-07", "10:00"), 30_000, saleLine(salKaos, 3, 15_000)), whB)
		cancelled := saleCancelled(order, wib("2026-10-08", "10:00"))

		salesFold(t, svc, placed)

		// Back to the pre-00006 shape: the order's parts and its day's row under no warehouse.
		for _, stmt := range []string{
			`UPDATE supplier_sale_order_parts SET warehouse_id = 0`,
			`UPDATE supplier_sale_daily_reports SET warehouse_id = 0`,
		} {
			err := h.DB().Exec(stmt).Error
			if err != nil {
				t.Fatal(err)
			}
		}

		log := refoldLog{sales: map[string][]*eventsv1.Event{"2026-10-07": {placed}, "2026-10-08": {cancelled}}}

		res := h.Race(t, 2, func(i int) error {
			if i == round%2 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)
			}

			if i == 0 {
				_, err := svc.SalePartWarehouses(ctx, log)

				return err
			}

			return svc.SalesFoldHandler()(ctx, cancelled)
		})
		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: %d failed", round, res.Failed())
		}

		// Which went first: a cancel row under warehouse B means the parts were filed before it took them back.
		var filed int64

		err := h.DB().Model(&supplier_service_models.SupplierSaleDailyReport{}).
			Where("day = CAST(? AS date) AND warehouse_id = ?", "2026-10-08", whB).
			Count(&filed).
			Error
		if err != nil {
			t.Fatal(err)
		}

		if filed > 0 {
			filedFirst++
		}

		// The re-folds the backfill runs next.
		for _, day := range []string{"2026-10-07", "2026-10-08"} {
			_, err = svc.DayRefold(ctx, supplier_v1.DayRefoldInput{Report: supplier_v1.ReportSaleDaily, SupplierID: salSumber, Day: day}, log)
			if err != nil {
				t.Fatalf("round %d: re-fold %s: %v", round, day, err)
			}
		}

		sameSaleRows(t, fmt.Sprintf("round %d", round), saleRows(t, h.DB()), map[string]saleFigure{
			rowKey("2026-10-07", salSumber, salKaos, sellingA, whB): {count: 3, value: 30_000},
			rowKey("2026-10-08", salSumber, salKaos, sellingA, whB): {count: -3, value: -30_000},
		})
	}

	t.Logf("%d rounds: the parts were filed before the cancel in %d, after it in %d", rounds, filedFirst, rounds-filedFirst)
}
