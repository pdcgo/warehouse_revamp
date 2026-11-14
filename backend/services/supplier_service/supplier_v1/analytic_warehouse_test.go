package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE SUPPLIER REPORTS CARRY THE WAREHOUSE (docs/technical/frontend/suppliers_decision.md#the-supplier-reports-carry-the-warehouse):
// a restock line's figures are filed under the warehouse it was RECEIVED at, an order line's under the warehouse it was
// TAKEN from; a correction, a cancel follow their own; and `san supplier backfill-warehouses` re-files what was folded
// before (warehouse 0) without moving any supplier's totals.

const (
	whA uint64 = 21
	whB uint64 = 22
	whC uint64 = 23
)

// inWarehouse sets the warehouse an event names — the receiving warehouse of an accept or a correction, the shipping
// warehouse of an order.
func inWarehouse(event *eventsv1.Event, warehouse uint64) *eventsv1.Event {
	switch m := event.GetMessage().(type) {
	case *eventsv1.Event_RestockAccepted:
		m.RestockAccepted.WarehouseId = warehouse
	case *eventsv1.Event_RestockReceivedCountCorrected:
		m.RestockReceivedCountCorrected.WarehouseId = warehouse
	case *eventsv1.Event_OrderPlaced:
		m.OrderPlaced.WarehouseId = warehouse
	case *eventsv1.Event_OrderCancelled:
		m.OrderCancelled.WarehouseId = warehouse
	}

	return event
}

func rowKey(day string, supplier, product, team, warehouse uint64) string {
	return fmt.Sprintf("%s|s%d|p%d|t%d|w%d", day, supplier, product, team, warehouse)
}

// restockRows is every row of the restock report, by its whole key.
func restockRows(t *testing.T, db *gorm.DB) map[string]supplier_service_models.SupplierMetricColumns {
	t.Helper()

	var rows []supplier_service_models.SupplierProductDailyReport

	err := db.Order("day, supplier_id, product_id, team_id, warehouse_id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the restock rows: %v", err)
	}

	out := map[string]supplier_service_models.SupplierMetricColumns{}
	for _, r := range rows {
		out[rowKey(r.Day.Format("2006-01-02"), r.SupplierID, r.ProductID, r.TeamID, r.WarehouseID)] = r.SupplierMetricColumns
	}

	return out
}

// saleRows is every row of Penjualan, by its whole key.
func saleRows(t *testing.T, db *gorm.DB) map[string]saleFigure {
	t.Helper()

	var rows []supplier_service_models.SupplierSaleDailyReport

	err := db.Order("day, supplier_id, product_id, team_id, warehouse_id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the sale rows: %v", err)
	}

	out := map[string]saleFigure{}
	for _, r := range rows {
		out[rowKey(r.Day.Format("2006-01-02"), r.SupplierID, r.ProductID, r.TeamID, r.WarehouseID)] = saleFigure{
			count: r.SalesCount, value: r.SalesValue,
		}
	}

	return out
}

// partRows is every order part, by order, supplier, product, team and warehouse.
func partRows(t *testing.T, db *gorm.DB) map[string]saleFigure {
	t.Helper()

	var rows []supplier_service_models.SupplierSaleOrderPart

	err := db.Order("order_id, supplier_id, product_id, team_id, warehouse_id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the parts: %v", err)
	}

	out := map[string]saleFigure{}
	for _, r := range rows {
		out[fmt.Sprintf("o%d|s%d|p%d|t%d|w%d", r.OrderID, r.SupplierID, r.ProductID, r.TeamID, r.WarehouseID)] = saleFigure{
			count: r.Units, value: r.Value,
		}
	}

	return out
}

func sameRestockRows(t *testing.T, name string, got, want map[string]supplier_service_models.SupplierMetricColumns) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s: %d rows %v, want %d %v", name, len(got), got, len(want), want)
	}

	for key, w := range want {
		g, found := got[key]
		if !found || g.RestockCount != w.RestockCount || !san_money.Equal(g.RestockValuation, w.RestockValuation) ||
			g.ShippingLostCount != w.ShippingLostCount || !san_money.Equal(g.ShippingLostValuation, w.ShippingLostValuation) ||
			g.ShippingBrokenCount != w.ShippingBrokenCount || !san_money.Equal(g.ShippingBrokenValuation, w.ShippingBrokenValuation) {
			t.Fatalf("%s: row %s = %+v (found %v), want %+v", name, key, g, found, w)
		}
	}
}

func sameSaleRows(t *testing.T, name string, got, want map[string]saleFigure) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s: %d rows %v, want %d %v", name, len(got), got, len(want), want)
	}

	for key, w := range want {
		g, found := got[key]
		if !found || g.count != w.count || !san_money.Equal(g.value, w.value) {
			t.Fatalf("%s: row %s = %+v (found %v), want %+v", name, key, g, found, w)
		}
	}
}

// Two accepts of one supplier's product on one day, received at two warehouses: two rows, each with its own figures —
// and a redelivery of either adds nothing.
func TestFold_EachAcceptIsFiledUnderTheWarehouseItWasReceivedAt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := inWarehouse(accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 10, total: 100_000, accepted: 9, broken: 1}), whA)
	b := inWarehouse(accept(2, sellingA, 31, "2026-10-03", line{product: 100, ordered: 4, total: 60_000, accepted: 3, lost: 1}), whB)

	fold(t, svc, a)
	fold(t, svc, b)
	fold(t, svc, b) // a redelivery

	sameRestockRows(t, "two warehouses", restockRows(t, db), map[string]supplier_service_models.SupplierMetricColumns{
		rowKey("2026-10-03", 31, 100, sellingA, whA): columns(9, 90_000, 0, 0, 1, 10_000),
		rowKey("2026-10-03", 31, 100, sellingA, whB): columns(3, 45_000, 1, 15_000, 0, 0),
	})
}

// A received-count correction moves the figures of the warehouse that corrected it — the one the restock was received
// at — on its own day; no other warehouse's row appears, and the accept's day stays.
func TestFold_ACorrectionIsFiledUnderItsOwnWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, inWarehouse(accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 10, total: 30_000, accepted: 10}), whB))
	fold(t, svc, inWarehouse(
		corrected(9001, 1, sellingA, 31, "2026-10-10", line{product: 100, ordered: 10, total: 30_000, accepted: -2, lost: 2}), whB))

	sameRestockRows(t, "a correction", restockRows(t, db), map[string]supplier_service_models.SupplierMetricColumns{
		rowKey("2026-10-03", 31, 100, sellingA, whB): columns(10, 30_000, 0, 0, 0, 0),
		rowKey("2026-10-10", 31, 100, sellingA, whB): columns(-2, -6_000, 2, 6_000, 0, 0),
	})
}

// Orders taken from two warehouses: each sale is filed under the warehouse its take drew the units from; a cancel takes
// back from the warehouse the placement added to, on its own day — also when it arrives first; a take that cannot say
// its warehouse files under the warehouse the order shipped from.
func TestSalesFold_ASaleIsFiledUnderTheWarehouseItWasTakenFrom(t *testing.T) {
	db := san_testdb.DB(t)

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		1: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whA, Units: 2}},
		2: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whB, Units: 3}},
		3: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 1}}, // the reader names no warehouse
		4: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whA, Units: 1}},
	}}
	svc := salesService(db, goods)

	salesFold(t, svc, inWarehouse(salePlaced(1, 1, wib("2026-10-07", "09:00"), 20_000, saleLine(salKaos, 2, 10_000)), whA))
	// Order 2's event names no warehouse: the take's batches say where the units were taken from.
	salesFold(t, svc, salePlaced(2, 2, wib("2026-10-07", "10:00"), 30_000, saleLine(salKaos, 3, 15_000)))
	salesFold(t, svc, inWarehouse(salePlaced(3, 3, wib("2026-10-07", "11:00"), 5_000, saleLine(salKaos, 1, 5_000)), whC))
	salesFold(t, svc, saleCancelled(2, wib("2026-10-08", "10:00")))

	// Order 4: its cancel (9 Oct) arrives before its placement (7 Oct).
	salesFold(t, svc, saleCancelled(4, wib("2026-10-09", "10:00")))
	salesFold(t, svc, inWarehouse(salePlaced(4, 4, wib("2026-10-07", "12:00"), 7_000, saleLine(salKaos, 1, 7_000)), whA))

	sameSaleRows(t, "sales", saleRows(t, db), map[string]saleFigure{
		rowKey("2026-10-07", salSumber, salKaos, sellingA, whA): {count: 3, value: 27_000},
		rowKey("2026-10-07", salSumber, salKaos, sellingA, whB): {count: 3, value: 30_000},
		rowKey("2026-10-07", salSumber, salKaos, sellingA, whC): {count: 1, value: 5_000},
		rowKey("2026-10-08", salSumber, salKaos, sellingA, whB): {count: -3, value: -30_000},
		rowKey("2026-10-09", salSumber, salKaos, sellingA, whA): {count: -1, value: -7_000},
	})

	parts := partRows(t, db)
	if _, found := parts[fmt.Sprintf("o2|s%d|p%d|t%d|w%d", salSumber, salKaos, sellingA, whB)]; !found {
		t.Fatalf("order 2's part is not kept under its warehouse: %v", parts)
	}
}

// A day re-fold rebuilds each warehouse's rows from the claims; a claim of an event that named no warehouse takes the
// warehouse the log's event names.
func TestDayRefold_Restock_RebuildsEveryWarehousesRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := inWarehouse(accept(701, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: 10}), whA)
	b := inWarehouse(accept(702, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 2, total: 10_000, accepted: 2}), whB)
	// An event folded before events named their warehouse: the log builds it with its warehouse today.
	old := inWarehouse(accept(703, sellingA, rfSupplier, rfDay, line{product: 200, ordered: 1, total: 4_000, accepted: 1}), 0)

	fold(t, svc, a)
	fold(t, svc, b)
	fold(t, svc, old)

	err := db.Exec(`DELETE FROM supplier_product_daily_reports WHERE warehouse_id = ?`, whB).Error
	if err != nil {
		t.Fatal(err)
	}

	logged := inWarehouse(accept(703, sellingA, rfSupplier, rfDay, line{product: 200, ordered: 1, total: 4_000, accepted: 1}), whC)
	log := refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {a, b, logged}}}

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false, log)
	if result.Counted != 3 || result.Claimed != 0 || !result.Changed() {
		t.Fatalf("result = %+v, want the three claims counted and rows moved", result)
	}

	sameRestockRows(t, "re-folded", restockRows(t, db), map[string]supplier_service_models.SupplierMetricColumns{
		rowKey(rfDay, rfSupplier, 100, sellingA, whA): columns(10, 100_000, 0, 0, 0, 0),
		rowKey(rfDay, rfSupplier, 100, sellingA, whB): columns(2, 10_000, 0, 0, 0, 0),
		rowKey(rfDay, rfSupplier, 200, sellingA, whC): columns(1, 4_000, 0, 0, 0, 0),
	})

	// Run again: nothing moves.
	if again := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false, log); again.Changed() {
		t.Fatalf("a second re-fold moved rows: %+v", again)
	}
}

// collapseWarehouses puts the reports and the parts back in the shape 00006 found them: every warehouse of a key folded
// into ONE row under warehouse 0 — the figures as they were before the reports carried the warehouse.
func collapseWarehouses(t *testing.T, db *gorm.DB) {
	t.Helper()

	for _, stmt := range []string{
		`CREATE TEMP TABLE c_restock ON COMMIT DROP AS
SELECT day, supplier_id, product_id, team_id, SUM(restock_count) AS rc, SUM(restock_valuation) AS rv,
       SUM(shipping_lost_count) AS lc, SUM(shipping_lost_valuation) AS lv,
       SUM(shipping_broken_count) AS bc, SUM(shipping_broken_valuation) AS bv
FROM supplier_product_daily_reports GROUP BY day, supplier_id, product_id, team_id`,
		`DELETE FROM supplier_product_daily_reports`,
		`INSERT INTO supplier_product_daily_reports (day, supplier_id, product_id, team_id, warehouse_id, restock_count,
    restock_valuation, shipping_lost_count, shipping_lost_valuation, shipping_broken_count, shipping_broken_valuation)
SELECT day, supplier_id, product_id, team_id, 0, rc, rv, lc, lv, bc, bv FROM c_restock`,
		`CREATE TEMP TABLE c_sales ON COMMIT DROP AS
SELECT day, supplier_id, product_id, team_id, SUM(sales_count) AS n, SUM(sales_value) AS v
FROM supplier_sale_daily_reports GROUP BY day, supplier_id, product_id, team_id`,
		`DELETE FROM supplier_sale_daily_reports`,
		`INSERT INTO supplier_sale_daily_reports (day, supplier_id, product_id, team_id, warehouse_id, sales_count, sales_value)
SELECT day, supplier_id, product_id, team_id, 0, n, v FROM c_sales`,
		`CREATE TEMP TABLE c_parts ON COMMIT DROP AS
SELECT order_id, supplier_id, product_id, team_id, SUM(units) AS n, SUM(value) AS v
FROM supplier_sale_order_parts GROUP BY order_id, supplier_id, product_id, team_id`,
		`DELETE FROM supplier_sale_order_parts`,
		`INSERT INTO supplier_sale_order_parts (order_id, supplier_id, product_id, team_id, warehouse_id, units, value)
SELECT order_id, supplier_id, product_id, team_id, 0, n, v FROM c_parts`,
	} {
		err := db.Exec(stmt).Error
		if err != nil {
			t.Fatalf("collapse: %v", err)
		}
	}
}

// warehouseBackfill is `san supplier backfill-warehouses`' order of work over the service's own methods.
func warehouseBackfill(t *testing.T, svc *supplier_v1.Service, log refoldLog) (supplier_v1.SalePartBackfillResult, int) {
	t.Helper()

	ctx := context.Background()

	parts, err := svc.SalePartWarehouses(ctx, log)
	if err != nil {
		t.Fatalf("SalePartWarehouses: %v", err)
	}

	days, err := svc.UnplacedReportDays(ctx)
	if err != nil {
		t.Fatalf("UnplacedReportDays: %v", err)
	}

	for _, day := range days {
		_, err = svc.DayRefold(ctx, supplier_v1.DayRefoldInput{Report: day.Report, SupplierID: day.SupplierID, Day: day.Day}, log)
		if err != nil {
			t.Fatalf("DayRefold %+v: %v", day, err)
		}
	}

	return parts, len(days)
}

// THE REFOLD EQUALITY: figures folded across warehouses, collapsed to the pre-00006 shape (warehouse 0) — one dedup claim
// pruned, as retention prunes them — then backfilled: every row, part and supplier total is back exactly as the live
// folds wrote them, and a second run finds nothing to do.
func TestWarehouseBackfill_RefilesEveryFigureAndKeepsEveryTotal(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		11: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whA, Units: 2}},
		12: {
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whB, Units: 3},
			{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, WarehouseID: whB, Units: 1},
		},
	}}
	svc := salesService(db, goods)

	accepts := []*eventsv1.Event{
		inWarehouse(accept(1, sellingA, salSumber, "2026-10-03", line{product: salKaos, ordered: 10, total: 100_000, accepted: 9, broken: 1}), whA),
		inWarehouse(accept(2, sellingA, salSumber, "2026-10-03", line{product: salKaos, ordered: 4, total: 60_000, accepted: 3, lost: 1}), whB),
		inWarehouse(accept(3, sellingB, salSinar, "2026-10-04", line{product: salCelana, ordered: 5, total: 25_000, accepted: 5}), whB),
	}
	correction := inWarehouse(
		corrected(9001, 1, sellingA, salSumber, "2026-10-06", line{product: salKaos, ordered: 10, total: 100_000, accepted: -1, lost: 1}), whA)

	for _, event := range append(accepts, correction) {
		fold(t, svc, event)
	}

	placed11 := inWarehouse(salePlaced(11, 11, wib("2026-10-07", "09:00"), 20_000, saleLine(salKaos, 2, 10_000)), whA)
	placed12 := inWarehouse(salePlaced(12, 12, wib("2026-10-07", "10:00"), 40_000,
		saleLine(salKaos, 3, 15_000), saleLine(salCelana, 1, 5_000)), whB)
	cancel12 := saleCancelled(12, wib("2026-10-08", "10:00"))

	for _, event := range []*eventsv1.Event{placed11, placed12, cancel12} {
		salesFold(t, svc, event)
	}

	wantRestock, wantSales, wantParts := restockRows(t, db), saleRows(t, db), partRows(t, db)

	before, err := svc.ReportTotals(ctx)
	if err != nil {
		t.Fatal(err)
	}

	collapseWarehouses(t, db)

	// Retention pruned accept 2's claim: the re-fold must read it from the log again, not drop its figures.
	err = db.Exec(`DELETE FROM supplier_event_logs WHERE id = ?`, accepts[1].GetEventId()).Error
	if err != nil {
		t.Fatal(err)
	}

	collapsed, err := svc.ReportTotals(ctx)
	if err != nil {
		t.Fatal(err)
	}

	log := refoldLog{
		accepts: map[string][]*eventsv1.Event{
			"2026-10-03": {accepts[0], accepts[1]}, "2026-10-04": {accepts[2]}, "2026-10-06": {correction},
		},
		sales: map[string][]*eventsv1.Event{"2026-10-07": {placed11, placed12}, "2026-10-08": {cancel12}},
	}

	parts, days := warehouseBackfill(t, svc, log)
	if parts.Orders != 2 || parts.FromTake != 2 || parts.FromOrder != 0 || parts.Unresolved != 0 {
		t.Fatalf("parts = %+v, want both orders re-read from their take", parts)
	}

	// Restock: 3 Oct and 6 Oct of Sumber, 4 Oct of Sinar; sales: 7 and 8 Oct of each.
	if days != 7 {
		t.Fatalf("%d supplier days re-folded, want 7", days)
	}

	sameRestockRows(t, "restock after the backfill", restockRows(t, db), wantRestock)
	sameSaleRows(t, "sales after the backfill", saleRows(t, db), wantSales)
	sameSaleRows(t, "parts after the backfill", partRows(t, db), wantParts)

	after, err := svc.ReportTotals(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if len(after) != len(before) || len(collapsed) != len(before) {
		t.Fatalf("suppliers before %d, collapsed %d, after %d", len(before), len(collapsed), len(after))
	}

	for id, b := range before {
		if !b.Same(after[id]) || !b.Same(collapsed[id]) {
			t.Fatalf("supplier %d: before %+v, collapsed %+v, after %+v — the totals moved", id, b, collapsed[id], after[id])
		}

		if collapsed[id].UnplacedRows == 0 || after[id].UnplacedRows != 0 {
			t.Fatalf("supplier %d: rows under no warehouse collapsed %d, after %d", id, collapsed[id].UnplacedRows, after[id].UnplacedRows)
		}
	}

	// Repeatable: nothing left to file or re-fold.
	parts, days = warehouseBackfill(t, svc, log)
	if parts.Orders != 0 || days != 0 {
		t.Fatalf("a second run: parts %+v, %d days — want nothing", parts, days)
	}
}

// A take that no longer adds up to the order's parts keeps the parts' figures under the warehouse the order shipped
// from; an order the log no longer holds stays under no warehouse — still counted with no chip.
func TestSalePartWarehouses_AFallbackKeepsThePartsFigures(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		21: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whA, Units: 2}},
		22: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: whA, Units: 1}},
	}}
	svc := salesService(db, goods)

	placed21 := inWarehouse(salePlaced(21, 21, wib("2026-10-07", "09:00"), 20_000, saleLine(salKaos, 2, 10_000)), whB)
	placed22 := inWarehouse(salePlaced(22, 22, wib("2026-10-07", "10:00"), 9_000, saleLine(salKaos, 1, 9_000)), whA)

	salesFold(t, svc, placed21)
	salesFold(t, svc, placed22)
	collapseWarehouses(t, db)

	// The take now reads otherwise (its batch moved to another supplier since).
	goods.takes[21] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSinar, TeamID: sellingA, WarehouseID: whA, Units: 2}}

	result, err := svc.SalePartWarehouses(ctx, refoldLog{sales: map[string][]*eventsv1.Event{"2026-10-07": {placed21}}})
	if err != nil {
		t.Fatal(err)
	}

	if result.Orders != 2 || result.FromOrder != 1 || result.Unresolved != 1 || result.FromTake != 0 {
		t.Fatalf("result = %+v, want order 21 under its order's warehouse and 22 left", result)
	}

	sameSaleRows(t, "parts", partRows(t, db), map[string]saleFigure{
		fmt.Sprintf("o21|s%d|p%d|t%d|w%d", salSumber, salKaos, sellingA, whB): {count: 2, value: 20_000},
		fmt.Sprintf("o22|s%d|p%d|t%d|w%d", salSumber, salKaos, sellingA, 0):   {count: 1, value: 9_000},
	})
}

// A claim's raw event — what the day re-fold reads back — keeps the warehouse the event named.
func TestFold_TheClaimKeepsTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := inWarehouse(accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 1, total: 1_000, accepted: 1}), whB)
	fold(t, svc, event)

	var claim struct{ Raw []byte }

	err := db.Raw(`SELECT raw FROM supplier_event_logs WHERE id = ?`, event.GetEventId()).Scan(&claim).Error
	if err != nil {
		t.Fatal(err)
	}

	read, err := san_event.Unmarshal(claim.Raw)
	if err != nil {
		t.Fatal(err)
	}

	if got := read.GetRestockAccepted().GetWarehouseId(); got != whB {
		t.Fatalf("the claim reads warehouse %d, want %d", got, whB)
	}
}
