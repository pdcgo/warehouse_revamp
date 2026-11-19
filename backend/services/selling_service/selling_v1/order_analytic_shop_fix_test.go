package selling_v1_test

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A FIX OF AN ORDER'S SHOP IN THE ORDER METRICS (an-orders-shop-is-fixed-and-counted-on-the-day): counted ON THE DAY OF
// THE FIX — every metric the order had counted, −1 with its figures under the old shop and +1 under the new — and no
// past day changes, whether its events arrive before the fix, after it, or are re-folded from the log.

// The order's days: placed on 20 Oct, returned on 22 Oct; the fix is made today.
var (
	fixPlacedAt   = time.Date(2026, 10, 20, 10, 0, 0, 0, time.FixedZone("WIB", 7*60*60))
	fixReturnedAt = time.Date(2026, 10, 22, 15, 0, 0, 0, time.FixedZone("WIB", 7*60*60))
)

const (
	fixPlacedDay   = "2026-10-20"
	fixReturnedDay = "2026-10-22"
)

func todayInJakarta() string {
	return time.Now().In(time.FixedZone("WIB", 7*60*60)).Format(time.DateOnly)
}

// key is a report row's key for the order's warehouse and creator (person 7).
func key(metric string, shopID uint64) string {
	return metric + "/" + itoa(shopID) + "/" + itoa(testWarehouse) + "/7"
}

func cols(count int64, total, mp float64) selling_service_models.OrderMetricColumns {
	return selling_service_models.OrderMetricColumns{OrderCount: count, Total: total, MpTotal: mp}
}

func wantFigures(t *testing.T, label string, got, want map[string]selling_service_models.OrderMetricColumns) {
	t.Helper()

	if !sameFigures(got, want) {
		t.Fatalf("%s:\n got %+v\nwant %+v", label, got, want)
	}
}

// returnedPricedOrder is a priced order of team 2 (14.350 total cost, 12.000 platform total, 350 fee) in shopID: placed
// on fixPlacedAt and moved into `return` at fixReturnedAt — its status and its timeline row, as the moves leave them.
// It answers the order and the return row's id.
func returnedPricedOrder(t *testing.T, svc *selling_v1.Service, db *gorm.DB, shopID uint64) (uint64, uint64) {
	t.Helper()

	orderID := pricedOrder(t, svc, shopID)
	backdateOrder(t, db, orderID, fixPlacedAt)

	logID := timelineMove(t, db, orderID, "return", fixReturnedAt)

	err := db.Exec(`UPDATE orders SET status = 'return' WHERE id = ?`, orderID).Error
	if err != nil {
		t.Fatalf("set return: %v", err)
	}

	return orderID, logID
}

// THE FIX'S DAY, AND NOTHING ELSE: the placement and the return were folded under the old shop on their days; the fix
// takes created, Warehouse Fee and Return Created off the old shop and onto the new TODAY, with the order's figures. The
// two past days read exactly as before, and the fix's redelivery counts nothing.
func TestOrderMetricFold_AShopFixCountsOnTheDayOfTheFix(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := selling_v1.NewService(db, knownCosts(), rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil,
		&fakeFees{percent: 2.5}, nil, nil, nil)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")
	orderID, returnLog := returnedPricedOrder(t, svc, db, wrong)

	foldEvent(t, analytic, placedEvent(orderID, fixPlacedAt))
	foldEvent(t, analytic, movedEvent(orderID, returnLog, "return", fixReturnedAt))

	placedDay := dayFigures(t, db, 2, fixPlacedDay)
	returnedDay := dayFigures(t, db, 2, fixReturnedDay)

	wantFigures(t, "the placement's day before the fix", placedDay, map[string]selling_service_models.OrderMetricColumns{
		key("created", wrong): cols(1, 14_350, 12_000), key("warehouse_fee", wrong): cols(1, 350, 0),
	})

	_, err := fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("fix: %v", err)
	}

	fixEvent := rec.events[len(rec.events)-1]
	if fixEvent.GetOrderShopChanged() == nil {
		t.Fatalf("the last event is %T, want OrderShopChanged", fixEvent.GetMessage())
	}

	foldEvent(t, analytic, fixEvent)
	foldEvent(t, analytic, fixEvent) // the redelivery

	today := todayInJakarta()

	wantFigures(t, "the fix's day", dayFigures(t, db, 2, today), map[string]selling_service_models.OrderMetricColumns{
		key("created", wrong):        cols(-1, -14_350, -12_000),
		key("created", right):        cols(1, 14_350, 12_000),
		key("warehouse_fee", wrong):  cols(-1, -350, 0),
		key("warehouse_fee", right):  cols(1, 350, 0),
		key("return_created", wrong): cols(-1, -14_350, -12_000),
		key("return_created", right): cols(1, 14_350, 12_000),
	})

	wantFigures(t, "the placement's day after the fix", dayFigures(t, db, 2, fixPlacedDay), placedDay)
	wantFigures(t, "the return's day after the fix", dayFigures(t, db, 2, fixReturnedDay), returnedDay)

	// And through the read the screen asks: the whole window nets the order under the new shop only.
	shops := createdByShop(t, db)
	if shops[wrong] != 0 || shops[right] != 1 {
		t.Fatalf("created by shop over the window = %v, want 0 under %d and 1 under %d", shops, wrong, right)
	}
}

// A LATE EVENT KEEPS ITS SHOP: the return's event arrives only after the fix was folded — it still counts under the
// shop the order was in when it was returned, and the fix's −1 there nets it. A move made AFTER the fix counts under
// the new shop. A re-fold of every day gives back exactly what the fold wrote.
func TestOrderMetricFold_ALateMoveCountsUnderItsShopAndTheRefoldAgrees(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := selling_v1.NewService(db, knownCosts(), rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil,
		&fakeFees{percent: 2.5}, nil, nil, nil)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")
	orderID, returnLog := returnedPricedOrder(t, svc, db, wrong)

	_, err := fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("fix: %v", err)
	}

	fixEvent := rec.events[len(rec.events)-1]

	// The fix first, then the placement and the return — both late.
	foldEvent(t, analytic, fixEvent)
	foldEvent(t, analytic, placedEvent(orderID, fixPlacedAt))
	foldEvent(t, analytic, movedEvent(orderID, returnLog, "return", fixReturnedAt))

	wantFigures(t, "a late placement", dayFigures(t, db, 2, fixPlacedDay), map[string]selling_service_models.OrderMetricColumns{
		key("created", wrong): cols(1, 14_350, 12_000), key("warehouse_fee", wrong): cols(1, 350, 0),
	})
	wantFigures(t, "a late return", dayFigures(t, db, 2, fixReturnedDay), map[string]selling_service_models.OrderMetricColumns{
		key("return_created", wrong): cols(1, 14_350, 12_000),
	})

	// A move after the fix — the parcel is lost on its way back — counts under the new shop.
	lostAt := time.Now()
	lostLog := timelineMove(t, db, orderID, "lost", lostAt)
	foldEvent(t, analytic, movedEvent(orderID, lostLog, "lost", lostAt))

	today := todayInJakarta()
	fixDay := dayFigures(t, db, 2, today)

	if got := fixDay[key("lost_created", right)]; got.OrderCount != 1 || !san_money.Equal(got.MpTotal, 12_000) {
		t.Fatalf("the lost move after the fix = %+v under the new shop, want 1 order of 12.000", got)
	}

	if _, ok := fixDay[key("lost_created", wrong)]; ok {
		t.Fatal("the lost move after the fix counted under the old shop")
	}

	// THE RE-FOLD: each day rebuilt from the orders and their timeline is what the fold wrote — no row rewritten.
	for _, day := range []string{fixPlacedDay, fixReturnedDay, today} {
		folded := dayFigures(t, db, 2, day)
		versions := dayVersions(t, db, 2, day)

		result := refoldOrders(t, analytic, 2, day, false)
		if result.Changed() {
			t.Fatalf("re-fold of %s changed rows: %+v", day, result.Rows)
		}

		wantFigures(t, "re-folded "+day, dayFigures(t, db, 2, day), folded)

		got := dayVersions(t, db, 2, day)
		if len(got) != len(versions) {
			t.Fatalf("re-fold of %s left %d rows, want %d", day, len(got), len(versions))
		}

		for k, ctid := range versions {
			if got[k] != ctid {
				t.Fatalf("re-fold of %s rewrote %s", day, k)
			}
		}
	}

	// …and from nothing: the fix's day wiped, the re-fold writes the move back.
	err = db.Exec(`DELETE FROM order_daily_reports WHERE team_id = 2 AND day = CAST(? AS date)`, today).Error
	if err != nil {
		t.Fatalf("wipe: %v", err)
	}

	refoldOrders(t, analytic, 2, today, false)
	wantFigures(t, "the fix's day re-folded from nothing", dayFigures(t, db, 2, today), fixDay)
}

// createdByShop is Order Created over every day, grouped by shop — the count per shop.
func createdByShop(t *testing.T, db *gorm.DB) map[uint64]int64 {
	t.Helper()

	var rows []struct {
		ShopID     uint64
		OrderCount int64
	}

	err := db.Raw(`SELECT shop_id, SUM(order_count) AS order_count FROM order_daily_reports
WHERE team_id = 2 AND metric = 'created' GROUP BY shop_id`).Scan(&rows).Error
	if err != nil {
		t.Fatalf("created by shop: %v", err)
	}

	out := map[uint64]int64{}
	for _, row := range rows {
		out[row.ShopID] = row.OrderCount
	}

	return out
}
