package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER METRICS' DAY RE-FOLD (a-wrong-day-is-refolded-from-the-log, for order_daily_reports): one seller team's
// Jakarta day rebuilt from its orders and their timeline — what the fold would have written had every event arrived.

const refoldDay = "2026-10-20"

// wibOn is a WIB clock time on refoldDay, as an instant.
func wibOn(hour, minute int) time.Time {
	return time.Date(2026, 10, 20, hour, minute, 0, 0, time.FixedZone("WIB", 7*60*60))
}

// backdateOrder moves an order's placement to `at` — its row's created_at, the instant its OrderPlaced carried.
func backdateOrder(t *testing.T, db *gorm.DB, orderID uint64, at time.Time) {
	t.Helper()

	err := db.Exec(`UPDATE orders SET created_at = ? WHERE id = ?`, at, orderID).Error
	if err != nil {
		t.Fatalf("backdate order %d: %v", orderID, err)
	}
}

// timelineMove writes a timeline row INTO `status` at `at` — the row a move's event is built from — and returns its id.
func timelineMove(t *testing.T, db *gorm.DB, orderID uint64, status string, at time.Time) uint64 {
	t.Helper()

	row := selling_service_models.OrderTimelineLog{OrderID: orderID, Status: status, From: "selling", CreatedAt: at}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("timeline row %s for order %d: %v", status, orderID, err)
	}

	return row.ID
}

func refoldOrders(t *testing.T, analytic *selling_v1.Analytic, teamID uint64, day string, dryRun bool) selling_v1.OrderDayRefoldResult {
	t.Helper()

	result, err := analytic.DayRefold(context.Background(), selling_v1.OrderDayRefoldInput{TeamID: teamID, Day: day, DryRun: dryRun})
	if err != nil {
		t.Fatalf("DayRefold %d %s: %v", teamID, day, err)
	}

	return result
}

// dayFigures is the team's report rows of the day by metric/shop/warehouse/user.
func dayFigures(t *testing.T, db *gorm.DB, teamID uint64, day string) map[string]selling_service_models.OrderMetricColumns {
	t.Helper()

	rows := []selling_service_models.OrderDailyReport{}

	err := db.Where("team_id = ? AND day = CAST(? AS date)", teamID, day).Find(&rows).Error
	if err != nil {
		t.Fatalf("report rows: %v", err)
	}

	out := map[string]selling_service_models.OrderMetricColumns{}
	for _, row := range rows {
		out[rowKey(row)] = row.OrderMetricColumns
	}

	return out
}

func rowKey(row selling_service_models.OrderDailyReport) string {
	return row.Metric + "/" + itoa(row.ShopID) + "/" + itoa(row.WarehouseID) + "/" + itoa(row.UserID)
}

// dayVersions is every report row's ctid on the day — any UPDATE moves it, so an unchanged map proves nothing was
// rewritten (the test is one transaction, so `last_updated` cannot tell).
func dayVersions(t *testing.T, db *gorm.DB, teamID uint64, day string) map[string]string {
	t.Helper()

	rows := []struct {
		Metric      string
		ShopID      uint64
		WarehouseID uint64
		UserID      uint64
		Ctid        string
	}{}

	err := db.Raw(`SELECT metric, shop_id, warehouse_id, user_id, ctid::text AS ctid FROM order_daily_reports
WHERE team_id = ? AND day = CAST(? AS date)`, teamID, day).Scan(&rows).Error
	if err != nil {
		t.Fatalf("row versions: %v", err)
	}

	out := map[string]string{}
	for _, r := range rows {
		out[rowKey(selling_service_models.OrderDailyReport{Metric: r.Metric, ShopID: r.ShopID, WarehouseID: r.WarehouseID, UserID: r.UserID})] = r.Ctid
	}

	return out
}

func claimed(t *testing.T, db *gorm.DB, eventID string) bool {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT count(*) FROM order_event_logs WHERE id = ?`, eventID).Scan(&n).Error
	if err != nil {
		t.Fatalf("claims: %v", err)
	}

	return n == 1
}

func sameFigures(a, b map[string]selling_service_models.OrderMetricColumns) bool {
	if len(a) != len(b) {
		return false
	}

	for key, x := range a {
		y, ok := b[key]
		if !ok || x.OrderCount != y.OrderCount || !san_money.Equal(x.Total, y.Total) || !san_money.Equal(x.MpTotal, y.MpTotal) {
			return false
		}
	}

	return true
}

// EVERY METRIC, REBUILT AS THE FOLD WOULD: a day of placements, a cancel, a return, an arrival and a lost parcel is
// folded; then the day's rows are wiped, two events are lost (never claimed) and a stray row appears. The re-fold
// writes back exactly what the fold had — the stray removed, the lost moves counted and claimed — and the late
// redelivery of each lost event folds nothing. An order placed at 23:30 WIB the day before counts on that day, not
// this one, though its move today does.
func TestOrderDayRefold_RebuildsEveryMetricAsTheFoldWould(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	shop := insertShop(t, db, 2, "Shop", "S1", "shopee")

	a, b, c := pricedOrder(t, svc, shop), pricedOrder(t, svc, shop), pricedOrder(t, svc, shop)

	backdateOrder(t, db, a, wibOn(9, 0))
	backdateOrder(t, db, b, wibOn(0, 30))
	backdateOrder(t, db, c, wibOn(0, 0).Add(-30*time.Minute)) // 23:30 WIB on the 19th

	returned := timelineMove(t, db, a, "return", wibOn(11, 0))
	timelineMove(t, db, a, "return_completed", wibOn(12, 0))
	timelineMove(t, db, b, "cancel", wibOn(13, 0))
	lost := timelineMove(t, db, c, "lost", wibOn(14, 0))

	foldEvent(t, analytic, placedEvent(a, wibOn(9, 0)))
	foldEvent(t, analytic, placedEvent(b, wibOn(0, 30)))
	foldEvent(t, analytic, placedEvent(c, wibOn(0, 0).Add(-30*time.Minute)))
	foldEvent(t, analytic, movedEvent(a, returned, "return", wibOn(11, 0)))
	foldEvent(t, analytic, returnAcceptedEvent(a, wibOn(12, 0)))
	foldEvent(t, analytic, cancelledEvent(b, wibOn(13, 0)))
	foldEvent(t, analytic, movedEvent(c, lost, "lost", wibOn(14, 0)))

	folded := dayFigures(t, db, 2, refoldDay)
	if len(folded) != 6 { // created, cancelled, return_created, return_arrived, lost_created, warehouse_fee
		t.Fatalf("the folded day holds %d rows, want 6: %+v", len(folded), folded)
	}

	if folded["created/"+itoa(shop)+"/"+itoa(testWarehouse)+"/7"].OrderCount != 2 {
		t.Fatalf("created = %+v, want the two orders placed on the 20th — not the one at 23:30 on the 19th", folded)
	}

	// THE DAMAGE: every row gone, the cancel's and the lost parcel's events never claimed, a stray row.
	err := db.Exec(`DELETE FROM order_daily_reports WHERE team_id = 2 AND day = CAST(? AS date)`, refoldDay).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`DELETE FROM order_event_logs WHERE id IN (?, ?)`, "order-cancelled:"+itoa(b), "order-status-changed:"+itoa(lost)).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`INSERT INTO order_daily_reports (day, metric, team_id, shop_id, warehouse_id, user_id, order_count, total, mp_total)
VALUES (CAST(? AS date), 'created', 2, 999, 0, 0, 5, 1, 1)`, refoldDay).Error
	if err != nil {
		t.Fatal(err)
	}

	result := refoldOrders(t, analytic, 2, refoldDay, false)

	if result.Claimed != 2 || result.Counted != 6 || result.InFlight != 0 || !result.Changed() {
		t.Fatalf("result = counted %d claimed %d in flight %d changed %v, want 6 moves, the 2 lost claimed",
			result.Counted, result.Claimed, result.InFlight, result.Changed())
	}

	got := dayFigures(t, db, 2, refoldDay)
	if !sameFigures(got, folded) {
		t.Fatalf("re-folded day = %+v\nwant what the fold wrote = %+v", got, folded)
	}

	if !claimed(t, db, "order-cancelled:"+itoa(b)) || !claimed(t, db, "order-status-changed:"+itoa(lost)) {
		t.Fatal("the lost moves' events are not claimed — a redelivery would count them twice")
	}

	// THE LATE REDELIVERIES fold nothing.
	foldEvent(t, analytic, cancelledEvent(b, wibOn(13, 0)))
	foldEvent(t, analytic, movedEvent(c, lost, "lost", wibOn(14, 0)))

	if again := dayFigures(t, db, 2, refoldDay); !sameFigures(again, folded) {
		t.Fatalf("after the redeliveries = %+v, want still %+v — a claimed event counted twice", again, folded)
	}

	// SAFE TO RE-RUN: nothing changes, nothing is rewritten.
	versions := dayVersions(t, db, 2, refoldDay)

	second := refoldOrders(t, analytic, 2, refoldDay, false)
	if second.Changed() || second.Claimed != 0 {
		t.Fatalf("a second run changed %v, claimed %d — want nothing", second.Changed(), second.Claimed)
	}

	if after := dayVersions(t, db, 2, refoldDay); len(after) != len(versions) {
		t.Fatalf("row versions %v → %v", versions, after)
	} else {
		for key, v := range versions {
			if after[key] != v {
				t.Fatalf("row %s was rewritten by a run that changed nothing", key)
			}
		}
	}
}

// A CORRECT DAY CHANGES NOTHING: every event folded, the re-fold finds every row already right and rewrites none.
func TestOrderDayRefold_ACorrectDayChangesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	shop := insertShop(t, db, 2, "Shop", "S1", "shopee")

	a, b := pricedOrder(t, svc, shop), pricedOrder(t, svc, shop)
	backdateOrder(t, db, a, wibOn(9, 0))
	backdateOrder(t, db, b, wibOn(10, 0))
	timelineMove(t, db, b, "cancel", wibOn(15, 0))

	foldEvent(t, analytic, placedEvent(a, wibOn(9, 0)))
	foldEvent(t, analytic, placedEvent(b, wibOn(10, 0)))
	foldEvent(t, analytic, cancelledEvent(b, wibOn(15, 0)))

	figures := dayFigures(t, db, 2, refoldDay)
	versions := dayVersions(t, db, 2, refoldDay)

	result := refoldOrders(t, analytic, 2, refoldDay, false)

	if result.Changed() || result.Claimed != 0 || result.Counted != 3 || len(result.Rows) != len(figures) {
		t.Fatalf("result = %+v, want 3 moves counted, nothing claimed, nothing changed", result)
	}

	if !sameFigures(dayFigures(t, db, 2, refoldDay), figures) {
		t.Fatal("a correct day's figures moved")
	}

	for key, v := range dayVersions(t, db, 2, refoldDay) {
		if versions[key] != v {
			t.Fatalf("row %s was rewritten though it was right", key)
		}
	}
}

// A MOVE IN FLIGHT IS LEFT TO THE FOLD: an order placed a moment ago, its event not yet folded, is neither counted nor
// claimed — the fold then counts it, once.
func TestOrderDayRefold_LeavesAMoveInFlightToTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	var placedAt time.Time

	err := db.Raw(`SELECT created_at FROM orders WHERE id = ?`, orderID).Scan(&placedAt).Error
	if err != nil {
		t.Fatal(err)
	}

	today := placedAt.In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")

	result := refoldOrders(t, analytic, 2, today, false)
	if result.InFlight != 1 || result.Counted != 0 || result.Claimed != 0 || len(result.Rows) != 0 {
		t.Fatalf("result = %+v, want the young move in flight and nothing written", result)
	}

	if claimed(t, db, "order-placed:"+itoa(orderID)) {
		t.Fatal("the re-fold claimed an event still on its way")
	}

	foldEvent(t, analytic, placedEvent(orderID, placedAt))

	if got := dayFigures(t, db, 2, today); len(got) != 2 {
		t.Fatalf("after the fold = %+v, want the created row and its fee row", got)
	}
}

// A DRY RUN WRITES NOTHING: it reports the lost placement it would count, and neither the row nor the claim is there
// after it.
func TestOrderDayRefold_ADryRunWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))
	backdateOrder(t, db, orderID, wibOn(9, 0))

	result := refoldOrders(t, analytic, 2, refoldDay, true)

	if !result.DryRun || result.Claimed != 1 || result.Counted != 1 || !result.Changed() || len(result.Rows) != 2 {
		t.Fatalf("dry run = %+v, want the lost placement counted and its two rows shown", result)
	}

	if got := dayFigures(t, db, 2, refoldDay); len(got) != 0 {
		t.Fatalf("a dry run wrote %+v", got)
	}

	if claimed(t, db, "order-placed:"+itoa(orderID)) {
		t.Fatal("a dry run left its claim behind")
	}
}

// IT REFUSES a missing team and a date that is not one.
func TestOrderDayRefold_Refuses(t *testing.T) {
	analytic := selling_v1.NewAnalytic(san_testdb.DB(t), fakeTeamTypes{})

	for name, in := range map[string]selling_v1.OrderDayRefoldInput{
		"no team":  {Day: refoldDay},
		"bad date": {TeamID: 2, Day: "2026-13-01"},
	} {
		_, err := analytic.DayRefold(context.Background(), in)
		if err == nil {
			t.Fatalf("%s: re-folded", name)
		}
	}
}
