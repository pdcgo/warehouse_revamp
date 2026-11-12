package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// RETURNED STOCK, READ BACK (the-inventory-metrics-prototype-is-accepted — units back on the shelf, value back, broken,
// missing, on the return accept's day; a warehouse sees units only). On the return fixture (rtStocked): Melati's order
// took Kaos Hitam ×3 (her own — 2 at 10.000 from supplier 41, 1 at 12.000 from supplier 42) and Kaos Polos ×3 (Sinar's,
// 20 % markup — the same layers), and Gudang 6 accepts the parcel YESTERDAY:
//
//	Kaos Hitam   2 sound (the oldest layer, 41: 2 × 10.000)            · 1 broken (newest layer, 42)
//	Kaos Polos   back as Melati's own 711: 1 sound (41: 10.000 × 1.2)  · 1 broken (42) · 1 missing (41)
//
// So Gudang 6 got back 3 units worth Rp 32.000, threw 2 away and never got 1 — all Melati's.

func returnBook(t *testing.T) *rtFixture {
	t.Helper()

	f := rtStocked(t)

	_, err := f.svc.OrderTransactionReturn(on(ctxUser(rtCrew), 1), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: rtReturnWarehouse, SellingTeamId: otMelati, TakeTransactionId: f.take, Description: "return of order #12",
		Lines: []*inventoryv1.OrderTransactionReturnLine{
			rtLine(otKaosHitam, otKaosHitam, 0, 2, 1, 0, f.rakR1),
			rtLine(otKaosPolos, rtOwnPolos, 0.2, 1, 1, 1, f.rakR2),
		},
	}))
	if err != nil {
		t.Fatalf("return yesterday: %v", err)
	}

	// The fixture named its batches' suppliers after their restock, behind the ledger's back — only the take and the
	// return are compared.
	if ledgerMatchesReport(t, f.db, "order", "return") == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	return f
}

func wantReturn(t *testing.T, what string, got *inventoryv1.InventoryReturnMetric, back int64, value float64, broken, missing int64) {
	t.Helper()

	if got.GetBackCount() != back || got.BackValue == nil || !san_money.Equal(got.GetBackValue(), value) ||
		got.GetBrokenCount() != broken || got.GetMissingCount() != missing {
		t.Fatalf("%s = %d back, Rp %v (set %v), %d broken, %d missing — want %d, Rp %v, %d, %d", what,
			got.GetBackCount(), got.GetBackValue(), got.BackValue != nil, got.GetBrokenCount(), got.GetMissingCount(),
			back, value, broken, missing)
	}
}

var returnSeller = asRole(1, role_basev1.Role_ROLE_SELLING_ADMIN)

// Sums on the accept's day, by product (a borrowed line under the own product it came back as), supplier (the layer's),
// seller (the ordering team) and warehouse (the return warehouse).
func TestReturnMetric_SumsTheDoorAndTheShelfOnTheAcceptDay(t *testing.T) {
	f := returnBook(t)

	wantReturn(t, "Melati's headline", mustRead(t, f.svc, returnSeller, otMelati, returnMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReturnSummary(), 3, 32_000, 2, 1)

	byDay := mustRead(t, f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(1), dayOf(0))).GetReturnByDay().GetItems()
	wantReturn(t, "yesterday, the accept", byDay[dayOf(1)], 3, 32_000, 2, 1)
	wantReturn(t, "today", byDay[dayOf(0)], 0, 0, 0, 0)

	byProduct := mustRead(t, f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		ids(otKaosHitam, rtOwnPolos, otKaosPolos)).GetReturnById().GetItems()
	wantReturn(t, "Kaos Hitam", byProduct[otKaosHitam], 2, 20_000, 1, 0)
	wantReturn(t, "Kaos Polos back as Melati's 711", byProduct[rtOwnPolos], 1, 12_000, 1, 1)
	wantReturn(t, "Sinar's Kaos Polos itself", byProduct[otKaosPolos], 0, 0, 0, 0)

	bySupplier := mustRead(t, f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
		ids(41, 42)).GetReturnById().GetItems()
	wantReturn(t, "supplier 41", bySupplier[41], 3, 32_000, 0, 1)
	wantReturn(t, "supplier 42", bySupplier[42], 0, 0, 2, 0)

	byWarehouse := mustRead(t, f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(rtReturnWarehouse, rtShipWarehouse)).GetReturnById().GetItems()
	wantReturn(t, "the return warehouse", byWarehouse[rtReturnWarehouse], 3, 32_000, 2, 1)
	wantReturn(t, "the warehouse that shipped it", byWarehouse[rtShipWarehouse], 0, 0, 0, 0)

	bySeller := mustRead(t, f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		ids(otMelati, otSinar)).GetReturnById().GetItems()
	wantReturn(t, "Melati, the ordering team", bySeller[otMelati], 3, 32_000, 2, 1)
	wantReturn(t, "Sinar, the lender", bySeller[otSinar], 0, 0, 0, 0)

	search, err := searchMetric(f.svc, returnSeller, otMelati, returnMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"back_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if got := search.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otKaosHitam, rtOwnPolos}) {
		t.Fatalf("by back = %v — want Kaos Hitam (2) then 711 (1)", got)
	}
}

// WHO READS: the return warehouse the units, never the value; the warehouse that shipped the order and the lender
// nothing (it is neither's); Melati and root all.
func TestReturnMetric_TheReturnWarehouseReadsUnitsOnly(t *testing.T) {
	f := returnBook(t)

	warehouse := mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_ADMIN), rtReturnWarehouse, returnMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReturnSummary()
	if warehouse.GetBackCount() != 3 || warehouse.BackValue != nil || warehouse.GetBrokenCount() != 2 || warehouse.GetMissingCount() != 1 {
		t.Fatalf("the return warehouse reads %+v — want 3 back, 2 broken, 1 missing and NO value", warehouse)
	}

	wantReturn(t, "root", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_ROOT), 1, returnMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReturnSummary(), 3, 32_000, 2, 1)

	for _, reader := range []struct {
		name string
		team uint64
		role role_basev1.Role
	}{
		{"the warehouse that shipped it", rtShipWarehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER},
		{"Sinar, the lender", otSinar, role_basev1.Role_ROLE_SELLING_OWNER},
	} {
		got := mustRead(t, f.svc, asRole(1, reader.role), reader.team, returnMetricID,
			analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReturnSummary()
		if got.GetBackCount() != 0 || got.GetBrokenCount() != 0 || got.GetMissingCount() != 0 || got.GetBackValue() != 0 {
			t.Fatalf("%s reads %+v — want nothing", reader.name, got)
		}
	}

	_, err := searchMetric(f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF), rtReturnWarehouse, returnMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "back_value", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the warehouse ranking by value: %v — want InvalidArgument", err)
	}
}
