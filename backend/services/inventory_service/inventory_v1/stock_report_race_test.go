//go:build raceaudit

// Concurrency audit for THE STOCK REPORTS (inventory_ledgers/stock_report.go — ready-stock-is-folded-in-the-stock-changes-
// own-step): every stock change adds its units and value to its day's `inventory_stock_daily_changes` rows, and a
// restock's or a return's door to `inventory_door_daily_reports`, as its transaction's LAST statements — one
// INSERT … ON CONFLICT DO UPDATE each, keys sorted. Many changes at one second land on ONE row; none may be lost, and the
// rows must never deadlock against the ledgers they follow. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_StockReport" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// changeRow is one report row's figures for the race's owner and warehouse.
func changeRow(t *testing.T, db *gorm.DB, product uint64, changeType string) (count int64, value float64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(change_count), 0) FROM inventory_stock_daily_changes
		WHERE warehouse_id = ? AND team_id = ? AND product_id = ? AND change_type = ?`,
		raceWarehouse, raceOwner, product, changeType).Scan(&count)
	db.Raw(`SELECT COALESCE(SUM(change_value), 0)::float8 FROM inventory_stock_daily_changes
		WHERE warehouse_id = ? AND team_id = ? AND product_id = ? AND change_type = ?`,
		raceWarehouse, raceOwner, product, changeType).Scan(&value)

	return count, value
}

// raceRestocks raises n restocks of `units` of product A for the race's owner into its warehouse, ready to accept.
func raceRestocks(t *testing.T, svc *inventory_v1.Service, n int, units int64) []*inventoryv1.RestockRequest {
	t.Helper()

	out := make([]*inventoryv1.RestockRequest, 0, n)

	for i := range n {
		res, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: raceOwner, WarehouseId: raceWarehouse,
			Items: []*inventoryv1.RestockRequestItem{{
				ProductId: raceProductA, ProductCode: fmt.Sprintf("A-%d", i), Name: "A", Count: units, Total: float64(units) * 1000,
			}},
		}))
		if err != nil {
			t.Fatalf("restock %d: %v", i, err)
		}

		out = append(out, res.Msg.GetRequest())
	}

	return out
}

// raceAcceptOneBroken accepts a restock with one unit broken, the rest on `rack`.
func raceAcceptOneBroken(svc *inventory_v1.Service, r *inventoryv1.RestockRequest, rack uint64) error {
	item := r.GetItems()[0]

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: raceWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: item.GetId(), ReceivedCount: item.GetCount(), BrokenCount: 1, Placements: placedOn(rack, item.GetCount()-1),
		}},
	}))

	return err
}

func reportRack(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	var rack uint64

	db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = 'rak-a'`, raceWarehouse).Scan(&rack)
	if rack == 0 {
		t.Fatal("seed: no rak-a")
	}

	return rack
}

// ONE ROW, MANY TAKES: twelve order takes of one unit of A at one second all land on today's ONE `order` row of A —
// each adds, none is lost, no deadlock — and the report equals the ledger.
func TestRace_StockReport_TwelveTakesIntoOneRow(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	const n = 12

	res := h.Race(t, n, func(i int) error {
		return raceTake(svc, fmt.Sprintf("key-report-%d", i), line(raceProductA, 1))
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d takes failed — there are 20 units", res.Failed(), n)
	}

	count, value := changeRow(t, h.DB(), raceProductA, "order")
	if count != -n || value != -n*1000 {
		t.Fatalf("the day's order row = %d units, Rp %v — want -%d and Rp -%d", count, value, n, n*1000)
	}

	var rows int64
	h.DB().Raw(`SELECT count(*) FROM inventory_stock_daily_changes`).Scan(&rows)

	if rows != 1 {
		t.Fatalf("%d report rows — want ONE: one key, one day, one type", rows)
	}

	ledgerMatchesReport(t, h.DB())
}

// TWO ACCEPTS INTO ONE ROW: two restocks of A accepted at the same second — the same day, warehouse, owner, product and
// supplier — both land on the one `restock` change row and the one door row.
func TestRace_StockReport_TwoAcceptsIntoOneRow(t *testing.T) {
	h := san_race.New(t, append([]string{"restock_problem_items", "restock_logs", "restock_items",
		"restocks", "warehouse_products"}, ledgerTables...)...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	rack := reportRack(t, h.DB())

	for round := range 5 {
		restocks := raceRestocks(t, svc, 2, 3)

		res := h.Race(t, 2, func(i int) error {
			return raceAcceptOneBroken(svc, restocks[i], rack)
		})
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 2 accepts failed", round, res.Failed())
		}

		count, value := changeRow(t, h.DB(), raceProductA, "restock")
		if want := int64(4 * (round + 1)); count != want || value != float64(want)*1000 {
			t.Fatalf("round %d: the restock row = %d units, Rp %v — want %d", round, count, value, want)
		}

		var broken int64
		h.DB().Raw(`SELECT COALESCE(SUM(broken_count), 0) FROM inventory_door_daily_reports WHERE source = 'restock'`).Scan(&broken)

		if want := int64(2 * (round + 1)); broken != want {
			t.Fatalf("round %d: the door row = %d broken — want %d", round, broken, want)
		}
	}

	var rows int64
	h.DB().Raw(`SELECT count(*) FROM inventory_door_daily_reports`).Scan(&rows)

	if rows != 1 {
		t.Fatalf("%d door rows — want ONE", rows)
	}

	ledgerMatchesReport(t, h.DB())
}

// A FOLD RACING A TAKE: restock accepts of A, order takes of A and of A + B together, and a price correction of an A
// batch, at once — every one's report rows are its last locks, after the batches every one of them queues on, so
// nothing deadlocks, nothing is refused, and the report equals the ledger after every round.
func TestRace_StockReport_AFoldRacingTakesAndAnAccept(t *testing.T) {
	h := san_race.New(t, append([]string{"restock_problem_items", "restock_logs", "restock_items",
		"restocks", "warehouse_products"}, ledgerTables...)...)
	seedLedgers(t, h.DB(), 50, raceProductA, raceProductB)
	svc := raceService(h.DB())
	rack := reportRack(t, h.DB())

	for round := range 6 {
		restocks := raceRestocks(t, svc, 2, 4)

		var batch, price struct {
			ID        uint64
			PriceUnit float64
		}

		h.DB().Raw(`SELECT id, price_unit FROM batches WHERE product_id = ? AND stock_count > 0 ORDER BY id DESC LIMIT 1`,
			raceProductA).Scan(&batch)
		price = batch

		res := h.Race(t, 9, func(i int) error {
			switch {
			case i < 2:
				return raceAcceptOneBroken(svc, restocks[i], rack)
			case i == 2:
				_, err := svc.BatchRevalue(ctxUser(77), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
					TeamId: raceOwner, BatchId: batch.ID, NewPriceUnit: price.PriceUnit + 10, ExpectedPriceUnit: price.PriceUnit,
					Reason: fmt.Sprintf("race round %d", round),
				}))

				return err
			case i%2 == 0:
				return raceTake(svc, fmt.Sprintf("key-fold-%d-%d", round, i), line(raceProductA, 1), line(raceProductB, 1))
			default:
				return raceTake(svc, fmt.Sprintf("key-fold-%d-%d", round, i), line(raceProductA, 1))
			}
		})
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 9 failed — no caller conflicts with another", round, res.Failed())
		}

		ledgerMatchesReport(t, h.DB())
	}
}
