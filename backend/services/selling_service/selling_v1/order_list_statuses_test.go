package selling_v1_test

import (
	"testing"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// setStatus puts an order straight into a status — the list reads the column, and the walk there is OrderStatusChange's
// own tests.
func setStatus(t *testing.T, db *gorm.DB, orderID uint64, status string) {
	t.Helper()

	err := db.Exec("UPDATE orders SET status = ? WHERE id = ?", status, orderID).Error
	if err != nil {
		t.Fatalf("set order %d to %s: %v", orderID, status, err)
	}
}

// THE RETURNS TAB IS TWO STATUSES (the-warehouse-list-has-a-returns-tab): `statuses` lists the orders in ANY of them —
// on their way back and accepted — counted together, and leaves every other status out. It ANDs with `status` like any
// filter, and the export's file holds the same rows.
func TestOrderList_StatusesListsAnyOfThem(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shop := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")

	coming := phoneOrder(t, svc, 2, shop, "0812000111")
	accepted := phoneOrder(t, svc, 2, shop, "0812000222")
	shipped := phoneOrder(t, svc, 2, shop, "0812000333")
	pending := phoneOrder(t, svc, 2, shop, "0812000444")

	setStatus(t, db, coming, "return")
	setStatus(t, db, accepted, "return_completed")
	setStatus(t, db, shipped, "shipped")

	returns := []sellingv1.OrderStatus{
		sellingv1.OrderStatus_ORDER_STATUS_RETURN,
		sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED,
	}

	// The warehouse's Returns tab: both returns, and the count says two.
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{Statuses: returns}), coming, accepted)

	// One status in the list is that status alone.
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{
		Statuses: []sellingv1.OrderStatus{sellingv1.OrderStatus_ORDER_STATUS_RETURN},
	}), coming)

	// Empty is no filter at all.
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{}), coming, accepted, shipped, pending)

	// ANDed with `status`: inside the list it narrows, outside it matches nothing.
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{
		Status:   sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED,
		Statuses: returns,
	}), accepted)
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{
		Status:   sellingv1.OrderStatus_ORDER_STATUS_PENDING,
		Statuses: returns,
	}))

	// THE FILE IS THE TAB: the Returns tab's export holds the two returns.
	file := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
		TeamId: testWarehouse,
		Filter: &sellingv1.OrderListFilter{Statuses: returns},
		View:   sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE,
	})

	if len(file.rows) != 3 {
		t.Fatalf("the Returns tab's file = %v — want the header and the two returns", file.rows)
	}

	got := map[string]bool{file.rows[1][10]: true, file.rows[2][10]: true}
	if !got["return"] || !got["return_completed"] {
		t.Fatalf("the file's statuses = %v, want return and return_completed", got)
	}
}
