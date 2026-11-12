package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// RESTOCK, READ BACK (the-inventory-metrics-prototype-is-accepted — units accepted, value accepted, broken and missing at
// the door, on the accept day; a warehouse sees units only). Through the real accept, on the ledger test's restock
// (team 2 → Gudang 5: Kaos Hitam 10 for Rp 100.000, Kaos Polos 5 for Rp 60.000):
//
//	2 days ago   shipping Rp 3.000 · Kaos Hitam 10 in the box, 1 broken → 9 good at 10.200 (supplier 61) = 91.800
//	                               · Kaos Polos 4 in the box (1 missing) → 4 good at 12.200            = 48.800
//	today        no shipping       · Kaos Hitam 10 good at 10.000 = 100.000 · Kaos Polos 5 good at 12.000 = 60.000
//
// So the week reads 28 units, Rp 300.600, 1 broken, 1 missing.

const restockStranger uint64 = 77

func restockBook(t *testing.T) *inventory_v1.Service {
	t.Helper()

	db := san_testdb.DB(t)
	svc := newService(t, db)

	rakA := newRack(t, svc, ledgerWarehouse, "rak-a")
	rakB := newRack(t, svc, ledgerWarehouse, "rak-b")

	first := ledgerRestock(t, svc, 3000)
	hitam := itemFor(first, ledgerKaosHitam)
	polos := itemFor(first, ledgerKaosPolos)

	// The line's supplier, as the create would store it with a live supplier (a-line-connects-to-any-teams-supplier).
	err := db.Exec(`UPDATE restock_items SET supplier_id = 61 WHERE id = ?`, hitam.GetId()).Error
	if err != nil {
		t.Fatalf("name Kaos Hitam's supplier: %v", err)
	}

	_, err = svc.RestockRequestAccept(on(ctxUser(7), 2), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: first.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: hitam.GetId(), ReceivedCount: 10, BrokenCount: 1, Placements: placedOn(rakA, 9)},
			{ItemId: polos.GetId(), ReceivedCount: 4, Placements: placedOn(rakB, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept 2 days ago: %v", err)
	}

	second := ledgerRestock(t, svc, 0)

	_, err = svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: second.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: itemFor(second, ledgerKaosHitam).GetId(), ReceivedCount: 10, Placements: placedOn(rakA, 10)},
			{ItemId: itemFor(second, ledgerKaosPolos).GetId(), ReceivedCount: 5, Placements: placedOn(rakB, 5)},
		},
	}))
	if err != nil {
		t.Fatalf("accept today: %v", err)
	}

	if ledgerMatchesReport(t, db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	return svc
}

func wantRestock(t *testing.T, what string, got *inventoryv1.InventoryRestockMetric, units int64, value float64, broken, missing int64) {
	t.Helper()

	if got.GetAcceptedCount() != units || got.AcceptedValue == nil || !san_money.Equal(got.GetAcceptedValue(), value) ||
		got.GetBrokenCount() != broken || got.GetMissingCount() != missing {
		t.Fatalf("%s = %d units, Rp %v (set %v), %d broken, %d missing — want %d, Rp %v, %d, %d", what,
			got.GetAcceptedCount(), got.GetAcceptedValue(), got.AcceptedValue != nil, got.GetBrokenCount(),
			got.GetMissingCount(), units, value, broken, missing)
	}
}

var (
	restockSeller    = asRole(1, role_basev1.Role_ROLE_SELLING_OWNER)
	restockWarehouse = asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	restockRoot      = asRole(1, role_basev1.Role_ROLE_ROOT)
)

// Sums, the day folding, every key group, and an asked key with nothing reading 0.
func TestRestockMetric_SumsTheAcceptsOnTheirDays(t *testing.T) {
	svc := restockBook(t)

	summary := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil)
	wantRestock(t, "the seller's headline", summary.GetRestockSummary(), 28, 300_600, 1, 1)

	byDay := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(2), dayOf(1), dayOf(0))).GetRestockByDay().GetItems()
	wantRestock(t, "2 days ago", byDay[dayOf(2)], 13, 140_600, 1, 1)
	wantRestock(t, "yesterday, nothing accepted", byDay[dayOf(1)], 0, 0, 0, 0)
	wantRestock(t, "today", byDay[dayOf(0)], 15, 160_000, 0, 0)

	byProduct := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		ids(ledgerKaosHitam, ledgerKaosPolos, 999)).GetRestockById().GetItems()
	wantRestock(t, "Kaos Hitam", byProduct[ledgerKaosHitam], 19, 191_800, 1, 0)
	wantRestock(t, "Kaos Polos", byProduct[ledgerKaosPolos], 9, 108_800, 0, 1)
	wantRestock(t, "a product never restocked", byProduct[999], 0, 0, 0, 0)

	bySupplier := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
		ids(61)).GetRestockById().GetItems()
	wantRestock(t, "supplier 61 — the first Kaos Hitam line", bySupplier[61], 9, 91_800, 1, 0)

	byWarehouse := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(ledgerWarehouse)).GetRestockById().GetItems()
	wantRestock(t, "Gudang 5, where it was received", byWarehouse[ledgerWarehouse], 28, 300_600, 1, 1)

	bySeller := mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		ids(ledgerSellingTeam)).GetRestockById().GetItems()
	wantRestock(t, "the restocking team", bySeller[ledgerSellingTeam], 28, 300_600, 1, 1)

	// The filters scope the numbers: supplier 61 alone, another warehouse nothing, a window before the first accept nothing.
	wantRestock(t, "filtered to supplier 61", mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, lastWeek(), supplierFilter(61)).GetRestockSummary(), 9, 91_800, 1, 0)
	wantRestock(t, "filtered to another warehouse", mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, lastWeek(), warehouseFilter(6)).GetRestockSummary(), 0, 0, 0, 0)
	wantRestock(t, "a window that ended 3 days ago", mustRead(t, svc, restockSeller, ledgerSellingTeam, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, windowOf(dayOf(7), dayOf(3))).GetRestockSummary(), 0, 0, 0, 0)
}

// WHO READS: the owning seller and root all of it; the receiving warehouse the units and the door, NEVER the value
// (a-warehouse-sees-no-seller-money — the field stays unset, so the screen drops its column); any other team nothing.
func TestRestockMetric_TheWarehouseReadsUnitsOnlyAndAStrangerNothing(t *testing.T) {
	svc := restockBook(t)

	wantRestock(t, "root", mustRead(t, svc, restockRoot, 1, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetRestockSummary(), 28, 300_600, 1, 1)

	warehouse := mustRead(t, svc, restockWarehouse, ledgerWarehouse, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetRestockSummary()
	if warehouse.GetAcceptedCount() != 28 || warehouse.AcceptedValue != nil || warehouse.GetBrokenCount() != 1 ||
		warehouse.GetMissingCount() != 1 {
		t.Fatalf("the warehouse's headline = %+v — want 28 units, 1 broken, 1 missing and NO value", warehouse)
	}

	byProduct := mustRead(t, svc, restockWarehouse, ledgerWarehouse, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, ids(ledgerKaosHitam)).GetRestockById().GetItems()
	if got := byProduct[ledgerKaosHitam]; got.GetAcceptedCount() != 19 || got.AcceptedValue != nil {
		t.Fatalf("the warehouse's Kaos Hitam = %+v — want 19 units and no value", got)
	}

	for _, reader := range []struct {
		name string
		team uint64
		role role_basev1.Role
	}{
		{"another selling team", restockStranger, role_basev1.Role_ROLE_SELLING_OWNER},
		{"another warehouse", 6, role_basev1.Role_ROLE_WAREHOUSE_OWNER},
	} {
		got := mustRead(t, svc, asRole(1, reader.role), reader.team, restockMetricID,
			analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetRestockSummary()
		if got.GetAcceptedCount() != 0 || got.GetBrokenCount() != 0 || got.GetMissingCount() != 0 || got.GetAcceptedValue() != 0 {
			t.Fatalf("%s reads %+v — want nothing", reader.name, got)
		}
	}
}

// Ranked a page at a time; supplier 0 (a line naming none) is left out of the Supplier group; a warehouse may not rank
// by the value it is not shown.
func TestRestockMetric_SearchRanksAndAWarehouseCannotSortByValue(t *testing.T) {
	svc := restockBook(t)

	first, err := searchMetric(svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"accepted_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 1)
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if got := first.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{ledgerKaosHitam}) || !first.GetHasNext() {
		t.Fatalf("page 1 = %v (next %v) — want Kaos Hitam, and another page", got, first.GetHasNext())
	}

	asc, err := searchMetric(svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"missing_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search by missing: %v", err)
	}

	if got := asc.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{ledgerKaosPolos, ledgerKaosHitam}) || asc.GetHasNext() {
		t.Fatalf("by missing = %v — want Kaos Polos (1) then Kaos Hitam (0), the tie broken by the key", got)
	}

	suppliers, err := searchMetric(svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
		"accepted_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search suppliers: %v", err)
	}

	if got := suppliers.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{61}) {
		t.Fatalf("suppliers = %v — want only 61 (supplier 0 cannot be filled)", got)
	}

	days, err := searchMetric(svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		"accepted_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search days: %v", err)
	}

	if got := days.GetKeys().GetDays().GetDays(); !slices.Equal(got, []string{dayOf(0), dayOf(2)}) {
		t.Fatalf("days = %v — want today (15) then 2 days ago (13), no quiet day", got)
	}

	_, err = searchMetric(svc, restockWarehouse, ledgerWarehouse, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"accepted_value", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a warehouse ranking by value: %v — want InvalidArgument", err)
	}

	byBroken, err := searchMetric(svc, restockWarehouse, ledgerWarehouse, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"broken_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("a warehouse ranking by broken: %v", err)
	}

	if got := byBroken.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{ledgerKaosHitam, ledgerKaosPolos}) {
		t.Fatalf("the warehouse by broken = %v — want Kaos Hitam then Kaos Polos", got)
	}
}

// A metric of the five beside another in one call, each answered in the asked order (one-call-answers-every-asked-metric).
func TestRestockMetric_AnsweredBesideLostStockInOneCall(t *testing.T) {
	svc := restockBook(t)

	res, err := svc.MetricData(restockSeller, connect.NewRequest(&inventoryv1.MetricDataRequest{
		TeamId: ledgerSellingTeam, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters:   []*analytic_basev1.FilterItem{lastWeek()},
		MetricIds: []string{lostMetricID, restockMetricID},
	}))
	if err != nil {
		t.Fatalf("two metrics: %v", err)
	}

	datas := res.Msg.GetMetricDatas()
	if len(datas) != 2 || datas[0].GetLostSummary() == nil || datas[1].GetRestockSummary() == nil {
		t.Fatalf("answers = %v — want Lost stock's, then Restock's", datas)
	}

	wantRestock(t, "Restock beside Lost stock", datas[1].GetRestockSummary(), 28, 300_600, 1, 1)
}
