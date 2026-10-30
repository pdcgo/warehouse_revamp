package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// the-order-list-filters-by-seven-dates — the five status dates. A status's date is the FIRST time the order entered
// it, read off the timeline: the window narrows by it, the stat counts the same set, and each row carries it.

var enteredDay = func(day, hour int) time.Time {
	return time.Date(2026, time.October, day, hour, 0, 0, 0, time.UTC)
}

// timelineRow writes one move into `status` at `at`, as a move would have.
func timelineRow(t *testing.T, db *gorm.DB, orderID uint64, status string, at time.Time) {
	t.Helper()

	err := db.Create(&selling_service_models.OrderTimelineLog{
		OrderID: orderID, Status: status, From: "warehouse", CreatedAt: at,
	}).Error
	if err != nil {
		t.Fatalf("timeline row for %d: %v", orderID, err)
	}
}

// enteredWindow is 10–12 October, inclusive, read off the first entry into the status `field` names.
func enteredWindow(field sellingv1.OrderDateField) *sellingv1.OrderListFilter {
	return &sellingv1.OrderListFilter{
		DateField:       field,
		CreatedFromUnix: enteredDay(10, 0).Unix(),
		CreatedToUnix:   enteredDay(12, 23).Unix(),
	}
}

func dateEnteredOf(t *testing.T, got *sellingv1.OrderListResponse, orderID uint64) int64 {
	t.Helper()

	for _, row := range orderRows(got) {
		if row.GetId() == orderID {
			return row.GetDateEnteredAtUnix()
		}
	}

	t.Fatalf("order %d is not on the page", orderID)

	return 0
}

func TestOrderList_FiltersByTheFirstEntryIntoAStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Processed on the 11th, handed back, and processed again on the 20th: it keeps the 11th.
	inWindow := seedImportOrder(t, db, shop, "IN", "processed")
	timelineRow(t, db, inWindow, "processed", enteredDay(11, 9))
	timelineRow(t, db, inWindow, "pending", enteredDay(15, 9))
	timelineRow(t, db, inWindow, "processed", enteredDay(20, 9))

	// Processed on the 5th, handed back, and processed again on the 11th: it keeps the 5th, so it is NOT in the window.
	firstBefore := seedImportOrder(t, db, shop, "BEFORE", "processed")
	timelineRow(t, db, firstBefore, "processed", enteredDay(5, 9))
	timelineRow(t, db, firstBefore, "pending", enteredDay(8, 9))
	timelineRow(t, db, firstBefore, "processed", enteredDay(11, 9))

	// The window is inclusive at its end.
	lastHour := seedImportOrder(t, db, shop, "LAST", "picked")
	timelineRow(t, db, lastHour, "processed", enteredDay(12, 23))
	timelineRow(t, db, lastHour, "picked", enteredDay(13, 8))

	// Never processed.
	never := seedImportOrder(t, db, shop, "NEVER", "pending")

	// Completed on the 11th and returned since: it entered completed in the window though it is no longer completed.
	returned := seedImportOrder(t, db, shop, "RETURNED", "return")
	timelineRow(t, db, returned, "processed", enteredDay(1, 9))
	timelineRow(t, db, returned, "completed", enteredDay(11, 14))
	timelineRow(t, db, returned, "return", enteredDay(14, 10))

	// Another team's order, processed in the window — outside the scope, whatever its date.
	elsewhere := insertShop(t, db, 3, "Toko B", "TOKO-B", "shopee")
	other := selling_service_models.Order{TeamID: 3, ShopID: elsewhere, WarehouseID: testWarehouse, Status: "processed", CustomerName: "Sari"}
	if err := db.Create(&other).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	timelineRow(t, db, other.ID, "processed", enteredDay(11, 9))

	processed := listFiltered(t, svc, 2, enteredWindow(sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_PROCESSED))
	wantOrders(t, processed, inWindow, lastHour)

	if got := dateEnteredOf(t, processed, inWindow); got != enteredDay(11, 9).Unix() {
		t.Fatalf("the bounced order is dated %v, want its FIRST entry, the 11th", time.Unix(got, 0).UTC())
	}

	completed := listFiltered(t, svc, 2, enteredWindow(sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_COMPLETED))
	wantOrders(t, completed, returned)

	if got := dateEnteredOf(t, completed, returned); got != enteredDay(11, 14).Unix() {
		t.Fatalf("the returned order is dated %v for completed, want the 11th", time.Unix(got, 0).UTC())
	}

	// A status date with no window narrows nothing — the orders that never entered it included.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{DateField: sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_PROCESSED}),
		inWindow, firstBefore, lastHour, never, returned)

	// The row carries the date only when the filter reads a status.
	created := listFiltered(t, svc, 2, &sellingv1.OrderListFilter{})
	if got := dateEnteredOf(t, created, inWindow); got != 0 {
		t.Fatalf("with the created date the row carries a status date of %d, want 0", got)
	}
}

// The stat counts what the list shows: the same status-date window, the same orders.
func TestOrderStat_FiltersByTheFirstEntryIntoAStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	inWindow := seedImportOrder(t, db, shop, "IN", "picked")
	timelineRow(t, db, inWindow, "processed", enteredDay(11, 9))

	outside := seedImportOrder(t, db, shop, "OUT", "picked")
	timelineRow(t, db, outside, "processed", enteredDay(2, 9))

	stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderStatFilter{
			DateField:       sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_PROCESSED,
			CreatedFromUnix: enteredDay(10, 0).Unix(),
			CreatedToUnix:   enteredDay(12, 23).Unix(),
		},
	}))
	if err != nil {
		t.Fatalf("OrderStat: %v", err)
	}

	var total int64
	for _, row := range stat.Msg.GetByStatus() {
		total += row.GetCount()
	}

	if total != 1 {
		t.Fatalf("the stat counts %d orders in the window, want 1 — the same set as the list", total)
	}
}
