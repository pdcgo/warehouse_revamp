package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// `san report refold` on a day whose one log row was never folded: a dry run says what it would add and writes
// nothing; the real run adds the row, claims the event and names the person re-fold the claim now owes; that person
// re-fold counts the row; a second run of either changes nothing.
func TestReportRefold_RebuildsTheDayFromTheLog(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, settlement: NewSettlementReports(db), target: "test"}
	ctx := context.Background()

	day := time.Date(2026, 2, 3, 0, 0, 0, 0, time.UTC)
	order := uint64(7001)

	// The order's account, opened by person 3 — the person report counts the order's rows for them.
	err := db.Create(&settlement_service_models.OrderSettlement{OrderID: order, TeamID: 9, ShopID: 41, CreatedByUserID: 3}).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&settlement_service_models.SettlementLog{
		OrderID: &order, ShopID: 41, TeamID: 9, ActorID: 3,
		SourceType: "importer", SettlementType: "fund", Change: 25_000,
		UniqueID: "san-refold-1", OccurredOn: day, PostedOn: day, CreatedAt: time.Now().Add(-2 * time.Hour),
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	in := settlement_v1.DayRefoldInput{Report: settlement_v1.ReportShopDaily, ShopID: 41, Day: "2026-02-03", DryRun: true}

	dry, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out := refoldLine(san.target, in, dry)
	for _, want := range []string{"DRY RUN", "shop 41", "lost and now claimed 1", "team 9: row added", "fund", "25.000"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dry-run output lacks %q:\n%s", want, out)
		}
	}

	var rows int64

	err = db.Raw(`SELECT COUNT(*) FROM shop_settlement_daily_reports WHERE shop_id = 41`).Scan(&rows).Error
	if err != nil || rows != 0 {
		t.Fatalf("the dry run wrote %d rows (%v)", rows, err)
	}

	in.DryRun = false

	done, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out = refoldLine(san.target, in, done)
	t.Logf("the real run:\n%s", out)

	if !strings.Contains(out, "re-folded") || done.Claimed != 1 ||
		!strings.Contains(out, "settlement-user-daily is still short by them") ||
		!strings.Contains(out, "report refold --report settlement-user-daily --user 3 --date 2026-02-03") {
		t.Fatalf("real run = %+v:\n%s", done, out)
	}

	again, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	if again.Changed() || again.Claimed != 0 || !strings.Contains(refoldLine(san.target, in, again), "team 9: unchanged") {
		t.Fatalf("a second run = %+v", again)
	}

	// THE PERSON RE-FOLD the output named.
	person, err := refoldInput(settlement_v1.ReportUserDaily, false, 0, true, 3)
	if err != nil {
		t.Fatal(err)
	}

	person.Day = "2026-02-03"

	repaired, err := san.ReportRefold(ctx, person)
	if err != nil {
		t.Fatal(err)
	}

	out = refoldLine(san.target, person, repaired)
	t.Logf("the person re-fold it names:\n%s", out)

	if repaired.Counted != 1 || repaired.Claimed != 0 || !strings.Contains(out, "settlement-user-daily · user 3") ||
		!strings.Contains(out, "team 9: row added") {
		t.Fatalf("person re-fold = %+v:\n%s", repaired, out)
	}

	second, err := san.ReportRefold(ctx, person)
	if err != nil || second.Changed() {
		t.Fatalf("a second person run = %+v, %v", second, err)
	}
}

// The flags name one scope, the one the report is keyed by — refused before any database is asked for.
func TestReportRefold_TheFlagsNameTheReportsScope(t *testing.T) {
	_, err := refoldInput(settlement_v1.ReportShopDaily, true, 41, true, 3)
	if !errors.Is(err, errRefoldShopFlag) {
		t.Fatalf("shop report with --user: %v", err)
	}

	_, err = refoldInput(settlement_v1.ReportUserDaily, true, 41, true, 3)
	if !errors.Is(err, errRefoldUserFlag) {
		t.Fatalf("person report with --shop: %v", err)
	}

	in, err := refoldInput(settlement_v1.ReportUserDaily, false, 0, true, 0)
	if err != nil || in.UserID == nil || *in.UserID != 0 {
		t.Fatalf("--user 0 is the person report's row of not recorded: %+v, %v", in, err)
	}

	in, err = refoldInput(settlement_v1.ReportUserDaily, false, 0, false, 0)
	if err != nil || in.UserID != nil {
		t.Fatalf("no --user leaves the scope empty for the service to refuse: %+v, %v", in, err)
	}
}

// The new reports' scope flags: each report takes its own key's flag and refuses another's, and an unknown report names
// every report the re-fold rebuilds — all before any database is asked for.
func TestReportRefold_EachReportTakesItsOwnScope(t *testing.T) {
	for report, flag := range map[string]string{
		selling_v1.ReportOrderDaily:    "team",
		supplier_v1.ReportRestockDaily: "supplier",
		supplier_v1.ReportSaleDaily:    "supplier",
	} {
		err := refoldFlagsFit(report, []string{flag})
		if err != nil {
			t.Fatalf("%s with --%s: %v", report, flag, err)
		}

		err = refoldFlagsFit(report, []string{flag, "shop"})
		if err == nil || !strings.Contains(err.Error(), "give --"+flag+", not --shop") {
			t.Fatalf("%s with --shop: %v", report, err)
		}
	}

	err := refoldFlagsFit(settlement_v1.ReportShopDaily, []string{"supplier"})
	if err == nil || !strings.Contains(err.Error(), "give --shop, not --supplier") {
		t.Fatalf("the shop report with --supplier: %v", err)
	}

	err = refoldFlagsFit("supplier-daily", nil)
	if !errors.Is(err, errRefoldUnknown) || !strings.Contains(err.Error(), supplier_v1.ReportSaleDaily) {
		t.Fatalf("an unknown report: %v", err)
	}
}

// seedOrder writes one selling order as selling_service stores it, placed at `at` from a shop of team 9 by person 3,
// its one line 3 × product 901 for Rp 30.000, sold for Rp 45.000 — its take `take`. It returns the shop.
func seedOrder(t *testing.T, db *gorm.DB, key string, at time.Time, take uint64) uint64 {
	t.Helper()

	shop := selling_service_models.Shop{TeamID: 9, Name: "Refold " + key, ShopCode: key, Marketplace: "shopee"}

	err := db.Create(&shop).Error
	if err != nil {
		t.Fatalf("seed shop: %v", err)
	}

	order := selling_service_models.Order{
		TeamID: 9, ShopID: shop.ID, WarehouseID: 5, CreatedByUserID: 3, Status: "pending", IdempotencyKey: key,
		GoodsCost: 30_000, TotalCost: 30_000, PlatformTotal: 45_000, TransactionID: &take, CreatedAt: at,
	}

	err = db.Create(&order).Error
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}

	total := 30_000.0

	err = db.Create(&selling_service_models.OrderItem{OrderID: order.ID, ProductID: 901, Quantity: 3, Total: &total}).Error
	if err != nil {
		t.Fatalf("seed order line: %v", err)
	}

	return shop.ID
}

// `san report refold --report order-daily` on a seller team's day whose placement event was lost: the dry run shows the
// rows it would add and writes nothing, the real run adds them and claims the event, a second run changes nothing.
func TestReportRefold_OrderDailyRebuildsATeamsDay(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, orderReports: NewOrderReports(db), target: "test"}
	ctx := context.Background()

	shop := seedOrder(t, db, "san-refold-order-1", time.Date(2026, 2, 3, 3, 0, 0, 0, time.UTC), 0)

	in := selling_v1.OrderDayRefoldInput{TeamID: 9, Day: "2026-02-03", DryRun: true}

	dry, err := san.OrderReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out := orderRefoldLine(san.target, in, dry)
	for _, want := range []string{"DRY RUN", "order-daily · team 9", "lost and now claimed 1",
		fmt.Sprintf("created · shop %d · warehouse 5 · user 3: row added", shop), "45.000"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dry-run output lacks %q:\n%s", want, out)
		}
	}

	var rows int64

	err = db.Raw(`SELECT COUNT(*) FROM order_daily_reports WHERE team_id = 9`).Scan(&rows).Error
	if err != nil || rows != 0 {
		t.Fatalf("the dry run wrote %d rows (%v)", rows, err)
	}

	in.DryRun = false

	done, err := san.OrderReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out = orderRefoldLine(san.target, in, done)
	t.Logf("the real run:\n%s", out)

	if done.Claimed != 1 || !strings.Contains(out, "re-folded") || !strings.Contains(out, "row added") {
		t.Fatalf("real run = %+v:\n%s", done, out)
	}

	again, err := san.OrderReportRefold(ctx, in)
	if err != nil || again.Changed() || again.Claimed != 0 || !strings.Contains(orderRefoldLine(san.target, in, again), ": unchanged") {
		t.Fatalf("a second run = %+v, %v", again, err)
	}
}

// `san report refold --report supplier-restock-daily` reads inventory's accepted restocks through inventory's own
// function: a lost accept of supplier 31 is counted and claimed — 7 good, 1 lost, 2 broken on its Jakarta day.
func TestReportRefold_SupplierRestockReadsInventorysAccepts(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, suppliers: NewSupplierFigures(db, NewReleaseInventory(db)), target: "test"}
	ctx := context.Background()

	supplier := uint64(31)
	seedRestock(t, db, "accepted", &supplier, time.Date(2026, 9, 2, 23, 30, 0, 0, time.UTC))

	in := supplier_v1.DayRefoldInput{Report: supplier_v1.ReportRestockDaily, SupplierID: 31, Day: "2026-09-03"}

	result, err := san.SupplierReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out := supplierRefoldLine(san.target, in, result)
	t.Logf("the run:\n%s", out)

	for _, want := range []string{"supplier-restock-daily · supplier 31 · 2026-09-03 · re-folded", "lost and now claimed 1",
		"product 100 · team 12: row added", "restock_count", "21.000", "shipping_broken_count"} {
		if !strings.Contains(out, want) {
			t.Fatalf("output lacks %q:\n%s", want, out)
		}
	}

	again, err := san.SupplierReportRefold(ctx, in)
	if err != nil || again.Changed() || again.Claimed != 0 {
		t.Fatalf("a second run = %+v, %v", again, err)
	}
}

// `san report refold --report supplier-sale-daily` reads selling's orders and prices a lost placement from inventory's
// take: 3 units of supplier 77's batch, sold for Rp 45.000 — counted on the order's day, the placement claimed.
func TestReportRefold_SupplierSaleReadsSellingsOrdersAndInventorysTake(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, suppliers: NewSupplierFigures(db, NewReleaseInventory(db)), target: "test"}
	ctx := context.Background()

	restock := inventory_service_models.InventoryTransaction{WarehouseID: 5, TeamID: 12, TxType: inventory_service_models.TxRestock}
	take := inventory_service_models.InventoryTransaction{WarehouseID: 5, TeamID: 12, TxType: inventory_service_models.TxOrder}

	for _, tx := range []*inventory_service_models.InventoryTransaction{&restock, &take} {
		err := db.Create(tx).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	batch := inventory_service_models.Batch{
		WarehouseID: 5, TeamID: 12, ProductID: 901, TransactionID: restock.ID, PriceUnit: 1000,
		StockCount: 7, StockValuation: 7000, InitStockCount: 10, InitStockValuation: 10000, SupplierID: 77,
	}

	err := db.Create(&batch).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&inventory_service_models.BatchLog{
		WarehouseID: 5, TeamID: 12, BatchID: batch.ID, TransactionID: take.ID,
		ChangeType: string(inventory_service_models.TxOrder), ChangeCount: -3, ChangeValuation: -3000,
		StockCountAfter: 7, StockValuationAfter: 7000, PriceUnitAfter: 1000,
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	seedOrder(t, db, "san-refold-sale-1", time.Date(2026, 2, 3, 3, 0, 0, 0, time.UTC), take.ID)

	in := supplier_v1.DayRefoldInput{Report: supplier_v1.ReportSaleDaily, SupplierID: 77, Day: "2026-02-03"}

	result, err := san.SupplierReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out := supplierRefoldLine(san.target, in, result)
	t.Logf("the run:\n%s", out)

	for _, want := range []string{"supplier-sale-daily · supplier 77", "lost and now claimed 1", "product 901 · team 12: row added",
		"sales_count", "45.000"} {
		if !strings.Contains(out, want) {
			t.Fatalf("output lacks %q:\n%s", want, out)
		}
	}

	again, err := san.SupplierReportRefold(ctx, in)
	if err != nil || again.Changed() || again.Claimed != 0 {
		t.Fatalf("a second run = %+v, %v", again, err)
	}
}
