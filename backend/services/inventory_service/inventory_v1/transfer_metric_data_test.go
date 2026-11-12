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
)

// TRANSFER, READ BACK — each side on its own day (a-transfer-counts-each-side-on-its-own-day). On the transfer fixture
// (Melati, Gudang 5 = A → Gudang 6 = B; at A Kaos Hitam 2 at 10.000 then 5 at 12.000, Kaos Polos 4 at 5.000):
//
//	T1  4 days ago  created: Kaos Hitam 3 — 2 × 10.000 + 1 × 12.000 = 32.000 leave A
//	    2 days ago  accepted at B: 2 arrived good (20.000), 1 missing
//	T2  3 days ago  created: Kaos Polos 2 = 10.000
//	    yesterday   cancelled — sent taken back that day
//	T3  today       created: Kaos Hitam 1 = 12.000, still on the road
//
//	day        sent            received        in transit at the day's end (under B)
//	4 ago      3 · 32.000      —               3 · 32.000   (T1)
//	3 ago      2 · 10.000      —               5 · 42.000   (T1 + T2)
//	2 ago      —               2 · 20.000      2 · 10.000   (T2 — T1 ended on its accept day)
//	yesterday  -2 · -10.000    —               —
//	today      1 · 12.000      —               1 · 12.000   (T3)

func transferBook(t *testing.T) *wtFixture {
	t.Helper()

	f := wtStocked(t)

	create := func(daysBack int, lines ...*inventoryv1.WarehouseTransferLine) *inventoryv1.WarehouseTransfer {
		res, err := f.svc.WarehouseTransferCreate(on(ctxUser(wtSeller), daysBack), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: lines, Note: "rebalance",
		}))
		if err != nil {
			t.Fatalf("create %d days ago: %v", daysBack, err)
		}

		return res.Msg.GetTransfer()
	}

	t1 := create(4, wtLine(wtKaosHitam, 3))
	t2 := create(3, wtLine(wtKaosPolos, 2))

	f.ship(t, t1.GetId())

	_, err := f.svc.WarehouseTransferAccept(on(ctxUser(wtStaffB), 2), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtB, TransferId: t1.GetId(), Lines: []*inventoryv1.WarehouseTransferCountedLine{
			counted(itemOf(t, t1, wtKaosHitam), 2, 0, f.rakB1),
		},
	}))
	if err != nil {
		t.Fatalf("accept T1 2 days ago: %v", err)
	}

	_, err = f.svc.WarehouseTransferCancel(on(ctxUser(wtSeller), 1), connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{
		TeamId: otMelati, TransferId: t2.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel T2 yesterday: %v", err)
	}

	create(0, wtLine(wtKaosHitam, 1))

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	return f
}

type transferWant struct {
	sent, received, transit                int64
	sentValue, receivedValue, transitValue float64
}

func wantTransfer(t *testing.T, what string, got *inventoryv1.InventoryTransferMetric, want transferWant) {
	t.Helper()

	if got.GetSentCount() != want.sent || got.GetReceivedCount() != want.received || got.GetInTransitCount() != want.transit ||
		got.SentValue == nil || got.ReceivedValue == nil || got.InTransitValue == nil ||
		!san_money.Equal(got.GetSentValue(), want.sentValue) || !san_money.Equal(got.GetReceivedValue(), want.receivedValue) ||
		!san_money.Equal(got.GetInTransitValue(), want.transitValue) {
		t.Fatalf("%s = sent %d (Rp %v) received %d (Rp %v) in transit %d (Rp %v) — want %+v", what,
			got.GetSentCount(), got.GetSentValue(), got.GetReceivedCount(), got.GetReceivedValue(),
			got.GetInTransitCount(), got.GetInTransitValue(), want)
	}
}

var (
	transferSeller = asRole(1, role_basev1.Role_ROLE_SELLING_OWNER)

	transferDays = map[int]transferWant{
		4: {sent: 3, sentValue: 32_000, transit: 3, transitValue: 32_000},
		3: {sent: 2, sentValue: 10_000, transit: 5, transitValue: 42_000},
		2: {received: 2, receivedValue: 20_000, transit: 2, transitValue: 10_000},
		1: {sent: -2, sentValue: -10_000},
		0: {sent: 1, sentValue: 12_000, transit: 1, transitValue: 12_000},
	}
)

// Every day as the table above: sent on the create day and taken back on the cancel day, received on the accept day,
// in transit from the create to the day before the accept or the cancel.
func TestTransferMetric_EachSideCountsOnItsOwnDay(t *testing.T) {
	f := transferBook(t)

	days := []string{dayOf(4), dayOf(3), dayOf(2), dayOf(1), dayOf(0)}

	byDay := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(days...)).GetTransferByDay().GetItems()

	for back, want := range transferDays {
		wantTransfer(t, dayOf(back), byDay[dayOf(back)], want)
	}

	// The headline: the window's movements, in transit at its last day — today.
	wantTransfer(t, "the week", mustRead(t, f.svc, transferSeller, otMelati, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetTransferSummary(),
		transferWant{sent: 4, sentValue: 44_000, received: 2, receivedValue: 20_000, transit: 1, transitValue: 12_000})

	// A window ending 3 days ago reads in transit at ITS last day.
	wantTransfer(t, "a window ending 3 days ago", mustRead(t, f.svc, transferSeller, otMelati, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, windowOf(dayOf(7), dayOf(3))).GetTransferSummary(),
		transferWant{sent: 5, sentValue: 42_000, transit: 5, transitValue: 42_000})

	// A week's row: its movements summed, in transit at its last day cut by the window and today.
	weekOf := func(back int) time.Time {
		d := daysAgo(back)
		day := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)

		return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
	}

	thisWeek := weekOf(0)
	week := transferWant{transit: 1, transitValue: 12_000}

	for back, d := range transferDays {
		if weekOf(back).Equal(thisWeek) {
			week.sent += d.sent
			week.sentValue += d.sentValue
			week.received += d.received
			week.receivedValue += d.receivedValue
		}
	}

	byWeek := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		dayKeys(thisWeek.Format("2006-01-02"))).GetTransferByDay().GetItems()
	wantTransfer(t, "this week", byWeek[thisWeek.Format("2006-01-02")], week)
}

// Two rows per transfer, one per side: by warehouse each shows its own; the warehouse filter matches either side; the
// receiver carries what is on the road to it.
func TestTransferMetric_EachWarehouseShowsItsOwnSide(t *testing.T) {
	f := transferBook(t)

	byWarehouse := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(wtA, wtB)).GetTransferById().GetItems()
	wantTransfer(t, "A, the sender", byWarehouse[wtA], transferWant{sent: 4, sentValue: 44_000})
	wantTransfer(t, "B, the receiver", byWarehouse[wtB],
		transferWant{received: 2, receivedValue: 20_000, transit: 1, transitValue: 12_000})

	wantTransfer(t, "filtered to B", mustRead(t, f.svc, transferSeller, otMelati, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, lastWeek(), warehouseFilter(wtB)).GetTransferSummary(),
		transferWant{received: 2, receivedValue: 20_000, transit: 1, transitValue: 12_000})

	byProduct := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		ids(wtKaosHitam, wtKaosPolos)).GetTransferById().GetItems()
	wantTransfer(t, "Kaos Hitam", byProduct[wtKaosHitam],
		transferWant{sent: 4, sentValue: 44_000, received: 2, receivedValue: 20_000, transit: 1, transitValue: 12_000})
	wantTransfer(t, "Kaos Polos — sent and taken back", byProduct[wtKaosPolos], transferWant{})

	search, err := searchMetric(f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		"in_transit_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	want := []string{dayOf(3), dayOf(4), dayOf(2), dayOf(0), dayOf(1)}
	if got := search.GetKeys().GetDays().GetDays(); !slices.Equal(got, want) {
		t.Fatalf("days by in transit = %v — want %v (yesterday last: nothing on the road, but a cancel's -2 sent)", got, want)
	}

	products, err := searchMetric(f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"sent_count", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search products: %v", err)
	}

	if got := products.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{wtKaosHitam}) {
		t.Fatalf("products = %v — want Kaos Hitam only (Kaos Polos nets to nothing)", got)
	}
}

// WHO READS: each warehouse its own side, in units only; Melati and root all; another seller nothing.
func TestTransferMetric_AWarehouseReadsItsOwnSideInUnits(t *testing.T) {
	f := transferBook(t)

	sender := mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF), wtA, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetTransferSummary()
	if sender.GetSentCount() != 4 || sender.GetReceivedCount() != 0 || sender.GetInTransitCount() != 0 ||
		sender.SentValue != nil || sender.ReceivedValue != nil || sender.InTransitValue != nil {
		t.Fatalf("A reads %+v — want 4 sent, nothing else, and no value", sender)
	}

	receiver := mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_OWNER), wtB, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetTransferSummary()
	if receiver.GetSentCount() != 0 || receiver.GetReceivedCount() != 2 || receiver.GetInTransitCount() != 1 ||
		receiver.SentValue != nil || receiver.ReceivedValue != nil || receiver.InTransitValue != nil {
		t.Fatalf("B reads %+v — want 2 received, 1 in transit, and no value", receiver)
	}

	wantTransfer(t, "root", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_ROOT), 1, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetTransferSummary(),
		transferWant{sent: 4, sentValue: 44_000, received: 2, receivedValue: 20_000, transit: 1, transitValue: 12_000})

	wantTransfer(t, "Sinar", mustRead(t, f.svc, asRole(1, role_basev1.Role_ROLE_SELLING_OWNER), otSinar, transferMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetTransferSummary(), transferWant{})

	for _, field := range []string{"sent_value", "received_value", "in_transit_value"} {
		_, err := searchMetric(f.svc, asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF), wtB, transferMetricID,
			analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, field, analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("a warehouse ranking by %s: %v — want InvalidArgument", field, err)
		}
	}
}
