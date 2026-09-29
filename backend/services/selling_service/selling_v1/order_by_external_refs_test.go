package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// insertRefOrder writes an order row carrying a marketplace ref — the lookup reads nothing else.
func insertRefOrder(t *testing.T, db *gorm.DB, teamID, shopID uint64, ref, status string, creator uint64) uint64 {
	t.Helper()

	order := selling_service_models.Order{
		TeamID:             teamID,
		ShopID:             shopID,
		WarehouseID:        testWarehouse,
		Status:             status,
		CustomerName:       "Buyer " + ref,
		OrderExternalRefID: ref,
		CreatedByUserID:    creator,
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order %s: %v", ref, err)
	}

	return order.ID
}

// A statement's refs resolved in one call: every order a ref finds in the TEAM — its shop, its creator
// and its status, cancelled and other shops' included — and a ref nothing carries is absent.
func TestOrderByExternalRefs_ResolvesAStatementsRefs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopA := insertShop(t, db, 2, "Melati", "M1", "shopee")
	shopB := insertShop(t, db, 2, "Mawar", "M2", "shopee")
	foreign := insertShop(t, db, 3, "Other", "O1", "shopee")

	live := insertRefOrder(t, db, 2, shopA, "2509AAA", "placed", 7)
	cancelled := insertRefOrder(t, db, 2, shopA, "2509BBB", "cancelled", 8)
	reentered := insertRefOrder(t, db, 2, shopA, "2509BBB", "confirmed", 9)
	otherShop := insertRefOrder(t, db, 2, shopB, "2509CCC", "shipped", 7)
	insertRefOrder(t, db, 3, foreign, "2509AAA", "placed", 50) // another team — never answered

	resp, err := svc.OrderByExternalRefs(context.Background(), connect.NewRequest(&sellingv1.OrderByExternalRefsRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderByExternalRefsFilter{Refs: []string{"2509AAA", "2509BBB", "2509CCC", "2509ZZZ"}},
	}))
	if err != nil {
		t.Fatalf("OrderByExternalRefs: %v", err)
	}

	found := func(ref string) map[uint64]*sellingv1.OrderRefItem {
		list := resp.Msg.GetItems()[ref]
		if list == nil || len(list.GetItems()) != 1 {
			return nil
		}

		return list.GetItems()[0].GetOrderRef().GetMapData()
	}

	a := found("2509AAA")
	if len(a) != 1 || a[live] == nil {
		t.Fatalf("2509AAA = %v, want only order %d — another team's order must never be answered", a, live)
	}

	if a[live].GetShopId() != shopA || a[live].GetCreatedByUserId() != 7 ||
		a[live].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PLACED {
		t.Errorf("2509AAA = %+v", a[live])
	}

	b := found("2509BBB")
	if len(b) != 2 || b[cancelled] == nil || b[reentered] == nil {
		t.Fatalf("2509BBB = %v, want the cancelled order and its re-entry", b)
	}

	if b[cancelled].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CANCELLED {
		t.Errorf("the cancelled order reads %v", b[cancelled].GetStatus())
	}

	c := found("2509CCC")
	if len(c) != 1 || c[otherShop].GetShopId() != shopB {
		t.Fatalf("2509CCC = %v, want order %d in shop %d", c, otherShop, shopB)
	}

	if _, ok := resp.Msg.GetItems()["2509ZZZ"]; ok {
		t.Error("a ref no order carries must be ABSENT")
	}
}
