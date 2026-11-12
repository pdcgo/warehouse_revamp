package inventory_v1_test

import (
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// READY STOCK, READ BACK — on hand at the end of each Jakarta day, a POSITION read backwards from today's batches
// (ready-stock-is-folded-in-the-stock-changes-own-step). Melati's Kaos Hitam, walked through seven writers on seven days,
// against a hand-computed series:
//
//	day        what happened                                              A (Gudang 5)    B (Gudang 6)    on hand
//	6 ago      restock accepted at A: 10 at 1.000                         10 · 10.000     —               10 · 10.000
//	5 ago      an order takes 3                                           7 · 7.000       —               7 · 7.000
//	4 ago      a price correction 1.000 → 1.500 (value only)             7 · 10.500      —               7 · 10.500
//	3 ago      a transfer sends 2 to B (in transit — in nobody's stock)   5 · 7.500       —               5 · 7.500
//	2 ago      B accepts the 2                                            5 · 7.500       2 · 3.000       7 · 10.500
//	yesterday  1 lost at A                                                4 · 6.000       2 · 3.000       6 · 9.000
//	today      the order is cancelled — its 3 come back at what they took 7 · 9.000       2 · 3.000       9 · 12.000
//
// 7 days ago nothing was on hand yet: 0.

type readyWant struct {
	units int64
	value float64
}

var readySeries = map[int]readyWant{
	7: {0, 0}, 6: {10, 10_000}, 5: {7, 7_000}, 4: {7, 10_500}, 3: {5, 7_500}, 2: {7, 10_500}, 1: {6, 9_000}, 0: {9, 12_000},
}

func readyBook(t *testing.T) *wtFixture {
	t.Helper()

	f := &wtFixture{sent: &sentEvents{}}
	f.db = san_testdb.DB(t)
	f.svc = inventory_v1.NewService(f.db, nil, nil, nil, f.sent.send, wtFacts(), nil, nil)
	f.rakA = newRack(t, f.svc, wtA, "rak-a")
	f.rakB1 = newRack(t, f.svc, wtB, "rak-b1")

	created, err := f.svc.RestockRequestCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: wtA,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: wtKaosHitam, ProductCode: "KH", Name: "Kaos Hitam", Count: 10, Total: 10_000}},
	}))
	if err != nil {
		t.Fatalf("restock: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = f.svc.RestockRequestAccept(on(ctxUser(wtStaffA), 6), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: r.GetId(), Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: r.GetItems()[0].GetId(), ReceivedCount: 10, Placements: placedOn(f.rakA, 10)},
		},
	}))
	if err != nil {
		t.Fatalf("accept 6 days ago: %v", err)
	}

	_, err = f.svc.OrderTransactionCreate(on(ctxUser(8), 5), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: "key-ready", WarehouseId: wtA, Lines: []*inventoryv1.OrderTransactionLine{line(wtKaosHitam, 3)},
	}))
	if err != nil {
		t.Fatalf("take 5 days ago: %v", err)
	}

	var batch models.Batch
	f.db.Where("product_id = ? AND warehouse_id = ?", wtKaosHitam, wtA).First(&batch)

	_, err = f.svc.BatchRevalue(on(ctxUser(wtSeller), 4), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
		TeamId: otMelati, BatchId: batch.ID, ExpectedPriceUnit: 1000, NewPriceUnit: 1500, Reason: "the invoice said 1.500",
	}))
	if err != nil {
		t.Fatalf("revalue 4 days ago: %v", err)
	}

	sent, err := f.svc.WarehouseTransferCreate(on(ctxUser(wtSeller), 3), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 2)},
	}))
	if err != nil {
		t.Fatalf("send 3 days ago: %v", err)
	}

	tr := sent.Msg.GetTransfer()
	f.ship(t, tr.GetId())

	_, err = f.svc.WarehouseTransferAccept(on(ctxUser(wtStaffB), 2), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtB, TransferId: tr.GetId(), Lines: []*inventoryv1.WarehouseTransferCountedLine{
			counted(itemOf(t, tr, wtKaosHitam), 2, 0, f.rakB1),
		},
	}))
	if err != nil {
		t.Fatalf("receive 2 days ago: %v", err)
	}

	_, err = f.svc.StockAdjust(on(opAdmin(opBudi), 1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: wtA, ProductId: wtKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch.ID, Quantity: 1, Reason: "gone",
	}))
	if err != nil {
		t.Fatalf("lose 1 yesterday: %v", err)
	}

	_, err = f.svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: otMelati, IdempotencyKey: "key-ready",
	}))
	if err != nil {
		t.Fatalf("release today: %v", err)
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	return f
}

func wantReady(t *testing.T, what string, got *inventoryv1.InventoryReadyMetric, want readyWant) {
	t.Helper()

	if got.GetOnHandCount() != want.units || !san_money.Equal(got.GetOnHandValue(), want.value) {
		t.Fatalf("%s = %d on hand, Rp %v — want %d, Rp %v", what, got.GetOnHandCount(), got.GetOnHandValue(), want.units, want.value)
	}
}

var readySeller = asRole(1, role_basev1.Role_ROLE_SELLING_CS)

// Every day of the week reads the hand-computed series; today's position is the batches'.
func TestReadyMetric_ThePositionMatchesTheHandComputedSeries(t *testing.T) {
	f := readyBook(t)

	keys := make([]string, 0, len(readySeries))
	for back := range readySeries {
		keys = append(keys, dayOf(back))
	}

	byDay := mustRead(t, f.svc, readySeller, otMelati, readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(keys...)).GetReadyByDay().GetItems()

	for back, want := range readySeries {
		wantReady(t, dayOf(back), byDay[dayOf(back)], want)
	}

	var now readyWant
	f.db.Raw(`SELECT COALESCE(SUM(stock_count), 0) AS units, COALESCE(SUM(stock_valuation), 0) AS value FROM batches
		WHERE team_id = ?`, otMelati).Row().Scan(&now.units, &now.value)

	if now != readySeries[0] {
		t.Fatalf("the batches hold %+v today — the series' today must be exactly that", now)
	}

	// The headline is the window's last day — never a sum over the days.
	wantReady(t, "the week's headline", mustRead(t, f.svc, readySeller, otMelati, readyMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReadySummary(), readySeries[0])
	wantReady(t, "a window ending 3 days ago", mustRead(t, f.svc, readySeller, otMelati, readyMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, windowOf(dayOf(7), dayOf(3))).GetReadySummary(), readySeries[3])

	// A week's and a month's row: the position at the period's last day, cut by the window and by today.
	for _, group := range []analytic_basev1.GroupType{analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY} {
		starts := map[string]int{}

		for back := range readySeries {
			d := daysAgo(back)
			day := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)

			start := day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
			if group == analytic_basev1.GroupType_GROUP_TYPE_MONTHLY {
				start = time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
			}

			// The period's edge is its latest day in the window: the smallest `back` inside it.
			key := start.Format("2006-01-02")
			if latest, ok := starts[key]; !ok || back < latest {
				starts[key] = back
			}
		}

		periods := make([]string, 0, len(starts))
		for k := range starts {
			periods = append(periods, k)
		}

		rows := mustRead(t, f.svc, readySeller, otMelati, readyMetricID, group, dayKeys(periods...),
			windowOf(dayOf(7), dayOf(0))).GetReadyByDay().GetItems()

		for key, back := range starts {
			wantReady(t, group.String()+" "+key, rows[key], readySeries[back])
		}
	}
}

// Keys add up to the whole: by warehouse, each holds its own; a warehouse reads its own units AND value
// (a-warehouse-sees-ready-value-but-a-shelf-only-units); root all, another seller nothing.
func TestReadyMetric_ByWarehouseAndWhoReads(t *testing.T) {
	f := readyBook(t)

	byWarehouse := mustRead(t, f.svc, readySeller, otMelati, readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(wtA, wtB)).GetReadyById().GetItems()
	wantReady(t, "A today", byWarehouse[wtA], readyWant{7, 9_000})
	wantReady(t, "B today", byWarehouse[wtB], readyWant{2, 3_000})

	threeAgo := mustRead(t, f.svc, readySeller, otMelati, readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(wtA, wtB), windowOf(dayOf(7), dayOf(3))).GetReadyById().GetItems()
	wantReady(t, "A at 3 days ago", threeAgo[wtA], readyWant{5, 7_500})
	wantReady(t, "B at 3 days ago — the 2 still on the road", threeAgo[wtB], readyWant{0, 0})

	wantReady(t, "Gudang A, its own units and value", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF), wtA,
		readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReadySummary(), readyWant{7, 9_000})
	wantReady(t, "Gudang B", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_OWNER), wtB,
		readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReadySummary(), readyWant{2, 3_000})
	wantReady(t, "root", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_ROOT), 1,
		readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReadySummary(), readyWant{9, 12_000})
	wantReady(t, "Sinar", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_SELLING_OWNER), otSinar,
		readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetReadySummary(), readyWant{})

	days, err := searchMetric(f.svc, readySeller, otMelati, readyMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		"on_hand_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search days: %v", err)
	}

	want := []string{dayOf(6), dayOf(0), dayOf(2), dayOf(4), dayOf(5), dayOf(1), dayOf(3)}
	if got := days.GetKeys().GetDays().GetDays(); !slices.Equal(got, want) {
		t.Fatalf("days by on hand = %v — want %v (ties by the later day; 7 days ago held nothing)", got, want)
	}

	warehouses, err := searchMetric(f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_ADMIN), wtA, readyMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "on_hand_value", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("a warehouse ranking by value: %v — Ready stock's value is the warehouse's to read", err)
	}

	if got := warehouses.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{wtKaosHitam}) {
		t.Fatalf("A's products by value = %v — want Kaos Hitam", got)
	}
}
