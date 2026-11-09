//go:build raceaudit

package supplier_v1_test

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE SALES FOLD UNDER CONCURRENCY (audits/services/supplier_service/concurrency/SalesFold.md): the order's row is the
// one lock a placement and its cancel meet on, and a day's rows are upserted in key order.
//
//	cd backend && go test -tags raceaudit -p 1 -run 'TestRace_Sales' -v ./services/supplier_service/supplier_v1/

var salesRaceTables = []string{"supplier_sale_daily_reports", "supplier_sale_order_parts", "supplier_sale_orders"}

// A placement and its cancel delivered AT ONCE, and each twice (a redelivery racing the first): whatever the order,
// the order's day reads +units and the cancel's day −units, once each — never doubled, never lost.
func TestRace_SalesPlacementAndCancelOfOneOrder(t *testing.T) {
	h := san_race.New(t, salesRaceTables...)

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}

	for round := range 10 {
		order := uint64(9_000 + round)
		goods.takes[order] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 3}}
	}

	svc := salesService(h.DB(), goods)

	for round := range 10 {
		order := uint64(9_000 + round)
		placed := salePlaced(order, order, wib("2026-10-07", "10:00"), 30_000, saleLine(salKaos, 3, 15_000))
		cancelled := saleCancelled(order, wib("2026-10-08", "10:00"))

		res := h.Race(t, 4, func(i int) error {
			// Both orderings: the even callers start a few milliseconds late on odd rounds.
			if i%2 == round%2 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			if i < 2 {
				return svc.SalesFoldHandler()(t.Context(), placed)
			}

			return svc.SalesFoldHandler()(t.Context(), cancelled)
		})
		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: %d callers failed", round, res.Failed())
		}
	}

	days := salesByDay(t, svc, salSumber, "2026-10-07", "2026-10-08")
	checkSale(t, "placed, ten orders", days["2026-10-07"], saleFigure{count: 30, value: 300_000})
	checkSale(t, "cancelled, ten orders", days["2026-10-08"], saleFigure{count: -30, value: -300_000})
}

// Many orders of ONE day touching the same two suppliers, their parts in opposite orders: the upsert's key order means
// they wait on each other's rows, never deadlock, and every unit is counted.
func TestRace_SalesOrdersOfOneDayShareTheirRows(t *testing.T) {
	h := san_race.New(t, salesRaceTables...)

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}

	for i := range 8 {
		parts := []supplier_v1.SaleTakePart{
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 1},
			{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, Units: 1},
		}
		if i%2 == 1 {
			parts[0], parts[1] = parts[1], parts[0]
		}

		goods.takes[uint64(9_100+i)] = parts
	}

	svc := salesService(h.DB(), goods)

	res := h.Race(t, 8, func(i int) error {
		order := uint64(9_100 + i)

		return svc.SalesFoldHandler()(t.Context(), salePlaced(order, order, wib("2026-10-09", "10:00"), 20_000,
			saleLine(salKaos, 1, 10_000), saleLine(salCelana, 1, 10_000)))
	})
	res.Report(t)

	if res.Count(san_race.Deadlock) > 0 || res.Failed() > 0 {
		t.Fatalf("%d failed (%d deadlocks)", res.Failed(), res.Count(san_race.Deadlock))
	}

	checkSale(t, "Sumber", salesByDay(t, svc, salSumber, "2026-10-09")["2026-10-09"], saleFigure{count: 8, value: 80_000})
	checkSale(t, "Sinar", salesByDay(t, svc, salSinar, "2026-10-09")["2026-10-09"], saleFigure{count: 8, value: 80_000})
}
