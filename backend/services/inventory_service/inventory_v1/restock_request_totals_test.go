package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE STORED FIGURES (00030): `restocks.subtotal` and `total`, and each line's `price_unit`, are written by every create
// and every edit — read back from the ROWS, never from an RPC's echo, which is built from the struct the handler just
// set and would agree with itself whether or not anything was written.

// wantStoredTotals reads the restock and its lines from the database and checks the figures they hold.
func wantStoredTotals(t *testing.T, db *gorm.DB, id uint64, subtotal, total float64, units map[uint64]float64, when string) {
	t.Helper()

	rr := storedRestock(t, db, id)
	if !san_money.Equal(rr.Subtotal, subtotal) || !san_money.Equal(rr.Total, total) {
		t.Fatalf("%s: stored subtotal/total = %v/%v, want %v/%v", when, rr.Subtotal, rr.Total, subtotal, total)
	}

	var lines []inventory_service_models.RestockItem

	err := db.Where("restock_id = ?", id).Find(&lines).Error
	if err != nil {
		t.Fatalf("%s: read lines: %v", when, err)
	}

	if len(lines) != len(units) {
		t.Fatalf("%s: %d lines stored, want %d", when, len(lines), len(units))
	}

	for _, line := range lines {
		if !san_money.Equal(line.PriceUnit, units[line.ProductID]) {
			t.Fatalf("%s: product %d price_unit = %v, want %v — total ÷ count (a-line-is-typed-as-its-total)",
				when, line.ProductID, line.PriceUnit, units[line.ProductID])
		}
	}
}

// Raised, edited while ongoing, edited again while arrived: the figures follow the lines every time, the freight in the
// total and never the courier's charge (the-couriers-charge-stays-out-of-total). A unit price that does not divide is
// stored as it is, never rounded (money-is-double-in-the-api-too).
func TestRestockRequest_StoresItsTotalsAndEachLinesUnitPrice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSuppliers(t, db, fakeSuppliers{arrMelati: true})

	raised := arrRaise(t, svc)

	// 100.000 + 150.000, and the 20.000 freight.
	wantStoredTotals(t, db, raised.GetId(), 250000, 270000, map[uint64]float64{100: 10000, 200: 30000}, "raised")

	edit := func(items []*inventoryv1.RestockRequestItem, freight float64) {
		t.Helper()

		_, err := svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: arrSellingTeam, RequestId: raised.GetId(), WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
			Receipt: "SCP123", ShipmentCost: freight, Items: items,
		}))
		if err != nil {
			t.Fatalf("edit: %v", err)
		}
	}

	ongoingLines := arrLines()
	ongoingLines[0].Total = 100000
	ongoingLines[0].Count = 3
	edit(ongoingLines, 5000)

	wantStoredTotals(t, db, raised.GetId(), 250000, 255000,
		map[uint64]float64{100: 100000.0 / 3, 200: 30000}, "edited while ongoing")

	_, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// While arrived only the lines change: Celana grows to 6, and a third line is added.
	arrivedLines := arrLines()
	arrivedLines[0].Total = 100000
	arrivedLines[0].Count = 3
	arrivedLines[1].Count = 6
	arrivedLines[1].Total = 180000
	arrivedLines = append(arrivedLines, &inventoryv1.RestockRequestItem{
		ProductId: 300, Sku: "SKU-TOPI", Name: "Topi", Count: 4, Total: 10000,
	})
	edit(arrivedLines, 5000)

	wantStoredTotals(t, db, raised.GetId(), 290000, 295000,
		map[uint64]float64{100: 100000.0 / 3, 200: 30000, 300: 2500}, "edited while arrived")
}

// A problem row is keyed by its restock and its product — the product finds its line — and carries the line's store,
// one row per kind (00030).
func TestRestockRequestAccept_KeysAProblemRowByRestockAndProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithStores(t, db, fakeSuppliers{arrMelati: true}, map[uint64]inventory_v1.SupplierStore{
		stMelatiShopee: {SupplierID: arrMelati, Live: true},
	})

	lines := arrLines()
	lines[0].SupplierChannelId = stMelatiShopee

	created, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: arrSellingTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount, Items: lines,
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	raised := created.Msg.GetRequest()
	shelf := stagingPlacement(t, db, arrWarehouse)

	// Kaos: 8 in the box of 10, 1 broken — 7 good, 1 broken, 2 missing. Celana arrives whole.
	_, err = svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: raised.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: raised.GetItems()[0].GetId(), ReceivedCount: 8, BrokenCount: 1, Placements: placedOn(shelf, 7)},
			{ItemId: raised.GetItems()[1].GetId(), ReceivedCount: 5, Placements: placedOn(shelf, 5)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	var rows []inventory_service_models.RestockProblemItem

	err = db.Where("restock_id = ?", raised.GetId()).Order("problem_type").Find(&rows).Error
	if err != nil {
		t.Fatalf("read problem rows: %v", err)
	}

	if len(rows) != 2 {
		t.Fatalf("%d problem rows, want a broken and a missing one: %+v", len(rows), rows)
	}

	for i, want := range []struct {
		kind  string
		count int64
	}{{"broken", 1}, {"missing", 2}} {
		row := rows[i]
		if row.ProductID != 100 || row.ProblemType != want.kind || row.Count != want.count ||
			row.SupplierChannelID == nil || *row.SupplierChannelID != stMelatiShopee {
			t.Fatalf("row %d = %+v, want product 100, %s × %d, from store %d", i, row, want.kind, want.count, stMelatiShopee)
		}
	}

	// The line keeps what was IN THE BOX, broken included (any-warehouse-member-counts-what-arrived).
	var kaos inventory_service_models.RestockItem

	err = db.Where("restock_id = ? AND product_id = ?", raised.GetId(), 100).Take(&kaos).Error
	if err != nil {
		t.Fatalf("read line: %v", err)
	}

	if kaos.ReceivedCount != 8 {
		t.Fatalf("received_count = %d, want 8 — the box, broken included", kaos.ReceivedCount)
	}
}
