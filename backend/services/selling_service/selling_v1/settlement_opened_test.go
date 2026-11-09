package selling_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// a-missing-account-is-found-by-its-opened-at — the order's side: SettlementOpened stamps once, the first time wins,
// and OrderList's `settlement_not_opened` (mirrored on OrderStat) lists exactly the orders still NULL.

// THE FIRST STAMP WINS: a second (a redelivery, a retried post) changes nothing, and an order that does not exist is no
// error — nothing here may refuse settlement after its post committed. The wire carries the moment; 0 = not yet.
func TestSettlementOpened_TheFirstStampWins(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := sortOrder(t, db, shop, 10_000, 20_000)
	first := time.Date(2026, 11, 5, 9, 0, 0, 0, time.UTC)

	err := svc.SettlementOpened(context.Background(), id, first)
	if err != nil {
		t.Fatalf("stamp: %v", err)
	}

	err = svc.SettlementOpened(context.Background(), id, first.Add(time.Hour))
	if err != nil {
		t.Fatalf("second stamp: %v", err)
	}

	err = svc.SettlementOpened(context.Background(), id+10_000, first)
	if err != nil {
		t.Fatalf("stamp of an unknown order: %v", err)
	}

	var order selling_service_models.Order

	err = db.Where("id = ?", id).Take(&order).Error
	if err != nil {
		t.Fatal(err)
	}

	if order.SettlementOpenedAt == nil || !order.SettlementOpenedAt.Equal(first) {
		t.Fatalf("settlement_opened_at = %v, want the first stamp %v", order.SettlementOpenedAt, first)
	}

	res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	if rows := orderRows(res.Msg); len(rows) != 1 || rows[0].GetSettlementOpenedAtUnix() != first.Unix() {
		t.Fatalf("rows = %v, want settlement_opened_at_unix %d", rows, first.Unix())
	}
}

// THE FILTER LISTS THE NULLS: of three orders, the two never stamped — the newest first — and the stat over the same
// filter counts the same two, so the tabs total what the table shows. Off, it lists everything.
func TestOrderList_SettlementNotOpenedListsTheNulls(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	missingA := sortOrder(t, db, shop, 10_000, 20_000)
	opened := sortOrder(t, db, shop, 10_000, 20_000)
	missingB := sortOrder(t, db, shop, 10_000, 20_000)

	err := svc.SettlementOpened(context.Background(), opened, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	list := func(notOpened bool) []uint64 {
		res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: 2,
			Filter: &sellingv1.OrderListFilter{SettlementNotOpened: notOpened},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
		if err != nil {
			t.Fatal(err)
		}

		return res.Msg.GetIds()
	}

	if got := list(true); !slices.Equal(got, []uint64{missingB, missingA}) {
		t.Fatalf("not opened = %v, want %v", got, []uint64{missingB, missingA})
	}

	if got := list(false); len(got) != 3 {
		t.Fatalf("unfiltered = %v, want all three", got)
	}

	stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderStatFilter{SettlementNotOpened: true},
	}))
	if err != nil {
		t.Fatal(err)
	}

	var counted int64
	for _, c := range stat.Msg.GetByStatus() {
		counted += c.GetCount()
	}

	if counted != 2 {
		t.Fatalf("the stat counts %d not opened, want the list's 2", counted)
	}
}
