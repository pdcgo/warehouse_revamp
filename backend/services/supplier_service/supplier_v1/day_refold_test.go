package supplier_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// A SUPPLIER'S DAY RE-FOLD (a-wrong-day-is-refolded-from-the-log, for supplier_product_daily_reports and
// supplier_sale_daily_reports): one supplier's Jakarta day rebuilt from the fold's claims plus the lost events the log
// still holds — what the fold would have written had every event arrived.

const (
	rfDay      = "2026-10-10"
	rfSupplier = uint64(61)
	rfOther    = uint64(62)
)

// refoldLog is the RefoldSource fake: the log's events per day.
type refoldLog struct {
	accepts map[string][]*eventsv1.Event
	sales   map[string][]*eventsv1.Event
}

func (l refoldLog) RestockAcceptsOn(_ context.Context, day string) ([]*eventsv1.Event, error) {
	return l.accepts[day], nil
}

func (l refoldLog) OrderSalesOn(_ context.Context, day string) ([]*eventsv1.Event, error) {
	return l.sales[day], nil
}

func supplierRefold(
	t *testing.T,
	svc *supplier_v1.Service,
	report string,
	supplier uint64,
	day string,
	dryRun bool,
	log refoldLog,
) supplier_v1.DayRefoldResult {
	t.Helper()

	result, err := svc.DayRefold(context.Background(),
		supplier_v1.DayRefoldInput{Report: report, SupplierID: supplier, Day: day, DryRun: dryRun}, log)
	if err != nil {
		t.Fatalf("DayRefold %s %d %s: %v", report, supplier, day, err)
	}

	return result
}

// rowVersions is the ctid of every row of a supplier's day — any UPDATE moves it (the test is one transaction, so
// `last_updated` cannot tell).
func rowVersions(t *testing.T, db *gorm.DB, table, day string, supplier uint64) map[string]string {
	t.Helper()

	rows := []struct {
		ProductID uint64
		TeamID    uint64
		Ctid      string
	}{}

	err := db.Raw(`SELECT product_id, team_id, ctid::text AS ctid FROM `+table+`
WHERE day = CAST(? AS date) AND supplier_id = ?`, day, supplier).Scan(&rows).Error
	if err != nil {
		t.Fatalf("row versions: %v", err)
	}

	out := map[string]string{}
	for _, r := range rows {
		out[strconv.FormatUint(r.ProductID, 10)+"/"+strconv.FormatUint(r.TeamID, 10)] = r.Ctid
	}

	return out
}

func sameVersions(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}

	for k, v := range a {
		if b[k] != v {
			return false
		}
	}

	return true
}

func claimCount(t *testing.T, db *gorm.DB, id string) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT count(*) FROM supplier_event_logs WHERE id = ?`, id).Scan(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n
}

// saleRow is one Penjualan row: units and value, and whether it exists.
func saleRow(t *testing.T, db *gorm.DB, day string, supplier, product, team uint64) (int64, float64, bool) {
	t.Helper()

	rows := []struct {
		SalesCount int64
		SalesValue float64
	}{}

	err := db.Raw(`SELECT sales_count, sales_value FROM supplier_sale_daily_reports
WHERE day = CAST(? AS date) AND supplier_id = ? AND product_id = ? AND team_id = ?`, day, supplier, product, team).
		Scan(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(rows) == 0 {
		return 0, 0, false
	}

	return rows[0].SalesCount, rows[0].SalesValue, true
}

func checkSaleRow(t *testing.T, db *gorm.DB, name, day string, supplier uint64, units int64, value float64) {
	t.Helper()

	gotUnits, gotValue, ok := saleRow(t, db, day, supplier, salKaos, sellingA)
	if !ok || gotUnits != units || !near(gotValue, value) {
		t.Fatalf("%s = %d units · Rp %v (row %v), want %d · Rp %v", name, gotUnits, gotValue, ok, units, value)
	}
}

// ── supplier-restock-daily ─────────────────────────────────────────────────────────────────────────

// A LOST ACCEPT IS REBUILT AND CLAIMED: two accepts of the supplier on the day, one folded, one lost; another supplier's
// accept the same day; and a stray row. The re-fold counts both accepts, removes the stray, leaves the other supplier
// alone and claims the lost accept — whose late redelivery then folds nothing. A second run changes nothing.
func TestDayRefold_Restock_ALostAcceptIsRebuiltAndClaimed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	folded := accept(701, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: 9, broken: 1})
	lost := accept(702, sellingA, rfSupplier, rfDay,
		line{product: 100, ordered: 4, total: 60_000, accepted: 3, lost: 1},
		line{product: 200, ordered: 2, total: 10_000, accepted: 2})
	other := accept(703, sellingA, rfOther, rfDay, line{product: 100, ordered: 1, total: 5_000, accepted: 1})

	fold(t, svc, folded)
	fold(t, svc, other)

	err := db.Exec(`INSERT INTO supplier_product_daily_reports (day, supplier_id, product_id, team_id, restock_count)
VALUES (CAST(? AS date), ?, 999, ?, 7)`, rfDay, rfSupplier, sellingA).Error
	if err != nil {
		t.Fatal(err)
	}

	otherBefore := rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfOther)
	log := refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {folded, lost, other}}}

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false, log)

	if result.Counted != 2 || result.Claimed != 1 || result.InFlight != 0 || !result.Changed() || len(result.Rows) != 3 {
		t.Fatalf("result = %+v, want both accepts counted, the lost one claimed, three rows (two products and the stray)", result)
	}

	// Product 100: 9 + 3 good at 10.000 and 15.000; 1 lost at 15.000; 1 broken at 10.000.
	if got := figureRow(t, db, rfDay, rfSupplier, 100, sellingA); got != columns(12, 135_000, 1, 15_000, 1, 10_000) {
		t.Fatalf("product 100 = %+v", got)
	}

	if got := figureRow(t, db, rfDay, rfSupplier, 200, sellingA); got != columns(2, 10_000, 0, 0, 0, 0) {
		t.Fatalf("product 200 = %+v", got)
	}

	if got := figureRow(t, db, rfDay, rfSupplier, 999, sellingA); got != columns(0, 0, 0, 0, 0, 0) {
		t.Fatalf("the stray row survived: %+v", got)
	}

	if !sameVersions(otherBefore, rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfOther)) {
		t.Fatal("another supplier's day was rewritten")
	}

	if claimCount(t, db, lost.GetEventId()) != 1 {
		t.Fatal("the lost accept is not claimed — a redelivery would count it twice")
	}

	fold(t, svc, lost) // the late redelivery

	if got := figureRow(t, db, rfDay, rfSupplier, 100, sellingA); got != columns(12, 135_000, 1, 15_000, 1, 10_000) {
		t.Fatalf("after the redelivery product 100 = %+v — counted twice", got)
	}

	versions := rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfSupplier)

	second := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false, log)
	if second.Changed() || second.Claimed != 0 || !sameVersions(versions, rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfSupplier)) {
		t.Fatalf("a second run = %+v and rewrote rows — want nothing", second)
	}
}

// A CORRECT DAY CHANGES NOTHING — and what counts is the accept AS IT WAS FOLDED (its claim), not as the log reads it
// today: a restock whose line was edited after its accept leaves the folded day alone.
func TestDayRefold_Restock_ACorrectDayChangesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := accept(711, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: 10})
	second := accept(712, sellingB, rfSupplier, rfDay, line{product: 300, ordered: 5, total: 25_000, accepted: 4, broken: 1})

	fold(t, svc, first)
	fold(t, svc, second)

	edited := accept(711, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: 7, lost: 3})
	versions := rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfSupplier)

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false,
		refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {edited, second}}})

	if result.Changed() || result.Claimed != 0 || result.Counted != 2 {
		t.Fatalf("result = %+v, want both counted from their claims and nothing changed", result)
	}

	if !sameVersions(versions, rowVersions(t, db, "supplier_product_daily_reports", rfDay, rfSupplier)) {
		t.Fatal("a correct day's rows were rewritten")
	}
}

// AN ACCEPT IN FLIGHT IS LEFT TO THE FOLD: accepted ten minutes ago, its event not yet folded — not counted, not claimed.
func TestDayRefold_Restock_LeavesAnAcceptInFlightToTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	now := time.Now().Add(-10 * time.Minute)
	today := now.In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")

	young := accept(721, sellingA, rfSupplier, today, line{product: 100, ordered: 1, total: 1_000, accepted: 1})
	young.OccurredAt = timestamppb.New(now)

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, today, false,
		refoldLog{accepts: map[string][]*eventsv1.Event{today: {young}}})

	if result.InFlight != 1 || result.Counted != 0 || result.Claimed != 0 || len(result.Rows) != 0 {
		t.Fatalf("result = %+v, want the young accept in flight and nothing written", result)
	}

	if claimCount(t, db, young.GetEventId()) != 0 {
		t.Fatal("the re-fold claimed an event still on its way")
	}
}

// A DRY RUN WRITES NOTHING: the lost accept is reported, neither its row nor its claim stays.
func TestDayRefold_Restock_ADryRunWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	lost := accept(731, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 2, total: 20_000, accepted: 2})

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, true,
		refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {lost}}})

	if !result.DryRun || result.Claimed != 1 || result.Counted != 1 || !result.Changed() {
		t.Fatalf("dry run = %+v, want the lost accept counted", result)
	}

	if got := figureRow(t, db, rfDay, rfSupplier, 100, sellingA); got != columns(0, 0, 0, 0, 0, 0) || claimCount(t, db, lost.GetEventId()) != 0 {
		t.Fatalf("a dry run wrote %+v or its claim", got)
	}
}

// IT REFUSES while a replay holds the fold's lock, and an unknown report, no supplier, a bad date, no log.
func TestDayRefold_Refuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	log := refoldLog{}

	setEventLock(t, db, `{"lock":true}`)

	_, err := svc.DayRefold(context.Background(),
		supplier_v1.DayRefoldInput{Report: supplier_v1.ReportRestockDaily, SupplierID: rfSupplier, Day: rfDay}, log)
	if !errors.Is(err, supplier_v1.ErrRefoldLocked) {
		t.Fatalf("under a replay's lock: %v, want ErrRefoldLocked", err)
	}

	for name, in := range map[string]supplier_v1.DayRefoldInput{
		"unknown report": {Report: "supplier-daily", SupplierID: rfSupplier, Day: rfDay},
		"no supplier":    {Report: supplier_v1.ReportSaleDaily, Day: rfDay},
		"bad date":       {Report: supplier_v1.ReportSaleDaily, SupplierID: rfSupplier, Day: "10-10-2026"},
	} {
		_, err = svc.DayRefold(context.Background(), in, log)
		if err == nil {
			t.Fatalf("%s: re-folded", name)
		}
	}

	_, err = svc.DayRefold(context.Background(),
		supplier_v1.DayRefoldInput{Report: supplier_v1.ReportSaleDaily, SupplierID: rfSupplier, Day: rfDay}, nil)
	if err == nil {
		t.Fatal("no log: re-folded")
	}
}

// ── supplier-sale-daily ────────────────────────────────────────────────────────────────────────────

// salesDayGoods: 9 Kaos sold for Rp 900.000 by each order 801–803, 8 from Sumber's batches and 1 from Sinar's.
func salesDayGoods() *fakeGoods {
	take := []supplier_v1.SaleTakePart{
		{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 8},
		{ProductID: salKaos, SupplierID: salSinar, TeamID: sellingA, Units: 1},
	}

	return &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{801: take, 802: take, 803: take}}
}

func kaosOrder(order uint64, at time.Time) *eventsv1.Event {
	return salePlaced(order, order, at, 900_000, saleLine(salKaos, 9, 900_000))
}

// A LOST PLACEMENT IS REBUILT AND CLAIMED: two orders placed on the day, one folded, one lost. Sumber's re-fold counts
// both and claims the lost one — Sinar's day is short by it now, and the result says so; Sinar's own re-fold then counts
// it. The late redelivery folds nothing for either.
func TestDayRefold_Sale_ALostPlacementIsRebuiltAndClaimed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := salesService(db, salesDayGoods())

	folded := kaosOrder(801, wib(rfDay, "09:00"))
	lost := kaosOrder(802, wib(rfDay, "10:00"))
	log := refoldLog{sales: map[string][]*eventsv1.Event{rfDay: {folded, lost}}}

	salesFold(t, svc, folded)

	result := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, false, log)

	if result.Counted != 2 || result.Claimed != 1 || !result.Changed() ||
		len(result.Short) != 1 || result.Short[0] != (supplier_v1.ShortScope{SupplierID: salSinar, Day: rfDay}) {
		t.Fatalf("result = %+v, want both counted, the lost one claimed, Sinar's day named short", result)
	}

	checkSaleRow(t, db, "Sumber", rfDay, salSumber, 16, 1_600_000)
	checkSaleRow(t, db, "Sinar, short until its own re-fold", rfDay, salSinar, 1, 100_000)

	sinar := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSinar, rfDay, false, log)
	if sinar.Claimed != 0 || sinar.Counted != 2 {
		t.Fatalf("Sinar's re-fold = %+v, want both orders counted from the claims", sinar)
	}

	checkSaleRow(t, db, "Sinar", rfDay, salSinar, 2, 200_000)

	salesFold(t, svc, lost) // the late redelivery

	checkSaleRow(t, db, "Sumber after the redelivery", rfDay, salSumber, 16, 1_600_000)
	checkSaleRow(t, db, "Sinar after the redelivery", rfDay, salSinar, 2, 200_000)

	versions := rowVersions(t, db, "supplier_sale_daily_reports", rfDay, salSumber)

	again := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, false, log)
	if again.Changed() || again.Claimed != 0 || !sameVersions(versions, rowVersions(t, db, "supplier_sale_daily_reports", rfDay, salSumber)) {
		t.Fatalf("a second run = %+v and rewrote rows — want nothing", again)
	}
}

// A LOST CANCEL IS TAKEN BACK ON ITS DAY: an order placed the day before (folded), cancelled on the day, its cancel
// lost. The day gains the take-back, the cancel is claimed, and its redelivery takes nothing back twice.
func TestDayRefold_Sale_ALostCancelIsTakenBackOnItsDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := salesService(db, salesDayGoods())

	placed := kaosOrder(803, wib("2026-10-09", "15:00"))
	cancelled := saleCancelled(803, wib(rfDay, "08:00"))

	salesFold(t, svc, placed)

	result := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, false,
		refoldLog{sales: map[string][]*eventsv1.Event{rfDay: {cancelled}}})

	if result.Claimed != 1 || result.Counted != 1 || len(result.Short) != 1 {
		t.Fatalf("result = %+v, want the cancel claimed and counted, Sinar's day short", result)
	}

	checkSaleRow(t, db, "the cancel's day", rfDay, salSumber, -8, -800_000)
	checkSaleRow(t, db, "the placement's day, untouched", "2026-10-09", salSumber, 8, 800_000)

	salesFold(t, svc, cancelled) // the late redelivery

	checkSaleRow(t, db, "the cancel's day after the redelivery", rfDay, salSumber, -8, -800_000)
}

// A LOST PLACEMENT WHOSE CANCEL WAS FOLDED FIRST, on a later day: the re-fold of the placement's day adds it there and
// names the cancel's day short — the fold would have taken it back there at once; that day's own re-fold does.
func TestDayRefold_Sale_ALatePlacementNamesItsCancelsDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := salesService(db, salesDayGoods())

	placed := kaosOrder(801, wib(rfDay, "09:00"))
	cancelled := saleCancelled(801, wib("2026-10-11", "09:00"))

	salesFold(t, svc, cancelled) // the cancel arrived; the placement never did

	result := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, false,
		refoldLog{sales: map[string][]*eventsv1.Event{rfDay: {placed}, "2026-10-11": {cancelled}}})

	wantShort := []supplier_v1.ShortScope{
		{SupplierID: salSinar, Day: rfDay}, {SupplierID: salSumber, Day: "2026-10-11"}, {SupplierID: salSinar, Day: "2026-10-11"},
	}
	if len(result.Short) != 3 {
		t.Fatalf("short = %+v, want %+v", result.Short, wantShort)
	}

	checkSaleRow(t, db, "the placement's day", rfDay, salSumber, 8, 800_000)

	if _, _, ok := saleRow(t, db, "2026-10-11", salSumber, salKaos, sellingA); ok {
		t.Fatal("the cancel's day was written by the placement day's re-fold")
	}

	supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, "2026-10-11", false,
		refoldLog{sales: map[string][]*eventsv1.Event{"2026-10-11": {cancelled}}})

	checkSaleRow(t, db, "the cancel's day after its own re-fold", "2026-10-11", salSumber, -8, -800_000)
}

// A CORRECT DAY CHANGES NOTHING; a placement in flight is neither counted nor claimed; a dry run writes nothing.
func TestDayRefold_Sale_ACorrectDayInFlightAndDryRun(t *testing.T) {
	db := san_testdb.DB(t)
	svc := salesService(db, salesDayGoods())

	folded := kaosOrder(801, wib(rfDay, "09:00"))
	salesFold(t, svc, folded)

	versions := rowVersions(t, db, "supplier_sale_daily_reports", rfDay, salSumber)

	correct := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, false,
		refoldLog{sales: map[string][]*eventsv1.Event{rfDay: {folded}}})
	if correct.Changed() || correct.Claimed != 0 || !sameVersions(versions, rowVersions(t, db, "supplier_sale_daily_reports", rfDay, salSumber)) {
		t.Fatalf("a correct day = %+v and rewrote rows", correct)
	}

	now := time.Now().Add(-5 * time.Minute)
	today := now.In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")
	young := kaosOrder(802, now)

	flight := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, today, false,
		refoldLog{sales: map[string][]*eventsv1.Event{today: {young}}})
	if flight.InFlight != 1 || flight.Claimed != 0 || len(flight.Rows) != 0 {
		t.Fatalf("in flight = %+v, want the young placement left to the fold", flight)
	}

	lost := kaosOrder(803, wib(rfDay, "11:00"))

	dry := supplierRefold(t, svc, supplier_v1.ReportSaleDaily, salSumber, rfDay, true,
		refoldLog{sales: map[string][]*eventsv1.Event{rfDay: {folded, lost}}})
	if !dry.DryRun || dry.Claimed != 1 || !dry.Changed() {
		t.Fatalf("dry run = %+v, want the lost placement counted", dry)
	}

	checkSaleRow(t, db, "after the dry run", rfDay, salSumber, 8, 800_000)

	var claimed int64

	err := db.Raw(`SELECT count(*) FROM supplier_sale_orders WHERE order_id IN (802, 803) AND placed_day IS NOT NULL`).Scan(&claimed).Error
	if err != nil || claimed != 0 {
		t.Fatalf("%d placements claimed (err %v) by an in-flight look and a dry run — want none", claimed, err)
	}
}
