package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// LOST STOCK, READ BACK (docs/business/analytic/rpc_provide_decision.md — inventory-lost-counts-the-warehouses-custody-
// losses, inventory-lost-is-gross, inventory-lost-groups-and-sits-under-inventory, a-warehouse-sees-its-lost-amount).
// The fold runs in the loss's own transaction, so every case posts through the real doors — a count's finalize, a
// Stock Adjust — and reads MetricData.
//
// On the stock count's fixture (Gudang 5): Melati's Kaos Hitam batch 1 is 8 at Rp 10.000 (from supplier 61 here),
// batch 2 is 2 at Rp 12.000; Sinar's Kaos Polos is 4 at Rp 20.000.
//
//	a count of Kaos Hitam, both racks empty, 2 torn   → broken 2 (not counted) · lost 6 at 10.000 + 2 at 12.000
//	a Stock Adjust: 1 Kaos Polos lost                 → lost 1 at 20.000
//	a Stock Adjust: 1 Kaos Polos damaged              → not counted
//
// So the warehouse loses 9 units worth Rp 104.000: Melati's 8 (84.000), Sinar's 1 (20.000).

const (
	lostSupplier  uint64 = 61
	lostStranger  uint64 = 77
	lostMetricID         = "metrics/inventory/lost"
	lostWantCount        = 9
	lostWantMoney        = 104_000.0
)

func lostToday() string {
	return time.Now().In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")
}

func lostWindow() *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: time.Now().AddDate(0, 0, -7).Format("2006-01-02"), DateMax: time.Now().AddDate(0, 0, 1).Format("2006-01-02")},
	}}
}

// lostBook posts the three losses and the damage above.
func lostBook(t *testing.T) *opnameFixture {
	t.Helper()

	f := opnameStocked(t)
	bs := batchesOf(t, f, otKaosHitam)

	err := f.db.Model(&models.Batch{}).Where("id = ?", bs[0].ID).Update("supplier_id", lostSupplier).Error
	if err != nil {
		t.Fatalf("name batch 1's supplier: %v", err)
	}

	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 0, 2)
	f.countRow(t, opDodi, s.GetId(), otKaosHitam, f.rakB, 0, 0)

	_, err = f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	polos := batchesOf(t, f, otKaosPolos)[0]
	f.lostOne(t, polos, f.rakA, 1)

	_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosPolos, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, BatchId: polos.ID, Quantity: 1,
		Reason: "torn",
	}))
	if err != nil {
		t.Fatalf("damage one: %v", err)
	}

	return f
}

func lostData(
	f *opnameFixture,
	team uint64,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	filters ...*analytic_basev1.FilterItem,
) (*inventoryv1.MetricData, error) {
	res, err := f.svc.MetricData(ctxUser(1), connect.NewRequest(&inventoryv1.MetricDataRequest{
		TeamId: team, GroupBy: group, Filters: append([]*analytic_basev1.FilterItem{lostWindow()}, filters...),
		Keys: keys, MetricIds: []string{lostMetricID},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetMetricDatas()[0], nil
}

func lostHeadline(t *testing.T, f *opnameFixture, team uint64, filters ...*analytic_basev1.FilterItem) *inventoryv1.InventoryLostMetric {
	t.Helper()

	data, err := lostData(f, team, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, filters...)
	if err != nil {
		t.Fatalf("headline as %d: %v", team, err)
	}

	return data.GetLostSummary()
}

func wantLost(t *testing.T, what string, got *inventoryv1.InventoryLostMetric, count int64, amount float64) {
	t.Helper()

	if got.GetLostCount() != count || !san_money.Equal(got.GetLostAmount(), amount) {
		t.Fatalf("%s = %d units, Rp %v — want %d, Rp %v", what, got.GetLostCount(), got.GetLostAmount(), count, amount)
	}
}

func ids(list ...uint64) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: list}}}
}

// A count's shortage and a Stock Adjust "lost" are counted, at their batch's price; broken stock — the count's torn two,
// the adjust's damaged one — is not. The report agrees with the register's lost rows.
func TestMetricData_CountsCountShortagesAndAdjustLostNotBroken(t *testing.T) {
	f := lostBook(t)

	wantLost(t, "the warehouse's headline", lostHeadline(t, f, otWarehouse), lostWantCount, lostWantMoney)

	var register struct {
		N int64
		V float64
	}

	f.db.Raw(`SELECT COALESCE(SUM(problem_stock_count), 0) AS n, COALESCE(SUM(problem_stock_count * price_unit), 0) AS v
		FROM warehouse_stock_problems WHERE problem_type = 'lost'`).Scan(&register)
	if register.N != lostWantCount || !san_money.Equal(register.V, lostWantMoney) {
		t.Fatalf("register's lost rows = %d, Rp %v — the report must equal them", register.N, register.V)
	}

	byProduct, err := lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, ids(otKaosHitam, otKaosPolos, opKaosUngu))
	if err != nil {
		t.Fatalf("by product: %v", err)
	}

	items := byProduct.GetLostById().GetItems()
	wantLost(t, "Kaos Hitam", items[otKaosHitam], 8, 84_000)
	wantLost(t, "Kaos Polos", items[otKaosPolos], 1, 20_000)
	// A key with no loss reads 0 — never missing (the-fill-step-scopes-its-numbers-by-the-filters).
	wantLost(t, "Kaos Ungu, never lost", items[opKaosUngu], 0, 0)

	bySupplier, err := lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, ids(lostSupplier))
	if err != nil {
		t.Fatalf("by supplier: %v", err)
	}

	wantLost(t, "supplier 61 (batch 1's six)", bySupplier.GetLostById().GetItems()[lostSupplier], 6, 60_000)

	bySeller, err := lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM, ids(otMelati, otSinar))
	if err != nil {
		t.Fatalf("by seller: %v", err)
	}

	wantLost(t, "Melati", bySeller.GetLostById().GetItems()[otMelati], 8, 84_000)
	wantLost(t, "Sinar", bySeller.GetLostById().GetItems()[otSinar], 1, 20_000)

	byDay, err := lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: []string{lostToday()}}}})
	if err != nil {
		t.Fatalf("by day: %v", err)
	}

	wantLost(t, "today", byDay.GetLostByDay().GetItems()[lostToday()], lostWantCount, lostWantMoney)
}

// GROSS (inventory-lost-is-gross): a Found that claims a loss back never lowers it.
func TestMetricData_AFoundClaimDoesNotSubtract(t *testing.T) {
	f := lostBook(t)

	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 3)

	_, err := f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approve the found: %v", err)
	}

	var claimed int64
	f.db.Raw(`SELECT COALESCE(SUM(claimed_stock_count), 0) FROM warehouse_stock_problems`).Scan(&claimed)

	if claimed == 0 {
		t.Fatalf("the found claimed nothing — the case needs a claim")
	}

	wantLost(t, "the headline after a found", lostHeadline(t, f, otWarehouse), lostWantCount, lostWantMoney)
}

// a-warehouse-sees-its-lost-amount: the warehouse reads both fields, each owning seller its own losses with their money,
// root every team's, and any other team nothing — not even by naming the warehouse in a filter.
func TestMetricData_TheWarehouseAndTheOwnerReadItAnotherTeamNothing(t *testing.T) {
	f := lostBook(t)

	wantLost(t, "Melati", lostHeadline(t, f, otMelati), 8, 84_000)
	wantLost(t, "Sinar", lostHeadline(t, f, otSinar), 1, 20_000)
	wantLost(t, "root", lostHeadline(t, f, san_auth.RootTeamID), lostWantCount, lostWantMoney)
	wantLost(t, "a stranger", lostHeadline(t, f, lostStranger), 0, 0)

	wh := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_WarehouseFilter{
		WarehouseFilter: &analytic_basev1.WarehouseFilter{WarehouseId: otWarehouse},
	}}
	wantLost(t, "a stranger naming the warehouse", lostHeadline(t, f, lostStranger, wh), 0, 0)
	// Melati reads only its own stock, even in the warehouse that also lost Sinar's.
	wantLost(t, "Melati in Gudang 5", lostHeadline(t, f, otMelati, wh), 8, 84_000)
}

// The four filters narrow the numbers; a shop filter is refused — lost stock has no shop.
func TestMetricData_FiltersNarrowAndAShopIsRefused(t *testing.T) {
	f := lostBook(t)

	product := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ProductFilter{
		ProductFilter: &analytic_basev1.ProductFilter{ProductId: otKaosPolos},
	}}
	wantLost(t, "Kaos Polos only", lostHeadline(t, f, otWarehouse, product), 1, 20_000)

	supplier := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_SupplierFilter{
		SupplierFilter: &analytic_basev1.SupplierFilter{SupplierId: lostSupplier},
	}}
	wantLost(t, "supplier 61 only", lostHeadline(t, f, otWarehouse, supplier), 6, 60_000)

	seller := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_TeamFilter{
		TeamFilter: &analytic_basev1.TeamFilter{TeamId: otSinar},
	}}
	wantLost(t, "Sinar's only", lostHeadline(t, f, otWarehouse, seller), 1, 20_000)

	_, err := lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
		&analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{ShopFilter: &analytic_basev1.ShopFilter{ShopId: 9}}})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a shop filter: %v, want InvalidArgument", err)
	}

	_, err = f.svc.MetricData(ctxUser(1), connect.NewRequest(&inventoryv1.MetricDataRequest{
		TeamId: otWarehouse, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: []string{lostMetricID},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no date range: %v, want InvalidArgument", err)
	}

	_, err = lostData(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: []string{"2026-11-04"}}}})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a Wednesday as a week's key: %v, want InvalidArgument", err)
	}
}

// Not custody losses: a restock parcel given up before it arrived, and a transfer box lost on the way, write no
// lost-stock row (inventory-lost-counts-the-warehouses-custody-losses).
func TestMetricData_RestockAndTransferLostAreNotCounted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := markLost(svc, arrSellingTeam, raised.GetId(), "courier lost it")
	if err != nil {
		t.Fatalf("mark the restock lost: %v", err)
	}

	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 2))
	f.ship(t, tr.GetId())

	_, err = markTransferLost(f, otMelati, tr.GetId())
	if err != nil {
		t.Fatalf("mark the transfer lost: %v", err)
	}

	var rows int64

	err = f.db.Model(&models.InventoryLostDailyReport{}).Count(&rows).Error
	if err != nil {
		t.Fatalf("count report rows: %v", err)
	}

	var restockRows int64
	db.Model(&models.InventoryLostDailyReport{}).Count(&restockRows)

	if rows != 0 || restockRows != 0 {
		t.Fatalf("lost stock rows after a restock and a transfer lost: %d and %d, want none", restockRows, rows)
	}
}
