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
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func listCreators(
	t *testing.T,
	svc *selling_v1.Service,
	teamID uint64,
	page *commonv1.CommonPagination,
) *sellingv1.OrderCreatorListResponse {
	t.Helper()

	res, err := svc.OrderCreatorList(context.Background(), connect.NewRequest(&sellingv1.OrderCreatorListRequest{
		TeamId: teamID,
		Page:   page,
	}))
	if err != nil {
		t.Fatalf("OrderCreatorList(team=%d): %v", teamID, err)
	}

	return res.Msg
}

// a-who-filter-lists-the-people-on-its-rows: the people who typed in an order THIS team may list — the
// seller's own, and for a warehouse every seller's orders shipping from it.
func TestOrderCreatorList_ThePeopleOnTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const ani, budi, stranger uint64 = 7, 8, 12

	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	otherShop := insertShop(t, db, 3, "Toko B", "TOKO-B", "shopee")

	day := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)

	anisOld := placeOrderAs(t, svc, asUser(ani), 2, shop)
	budis := placeOrderAs(t, svc, asUser(budi), 2, shop)
	anisNew := placeOrderAs(t, svc, asUser(ani), 2, shop)
	strangers := placeOrderAs(t, svc, asUser(stranger), 3, otherShop)
	// Nobody recorded: an order from before the creator was kept.
	unrecorded := placeOrderAs(t, svc, context.Background(), 2, shop)

	backdate(t, db, anisOld, day)
	backdate(t, db, budis, day.AddDate(0, 0, 1))
	backdate(t, db, anisNew, day.AddDate(0, 0, 2))
	backdate(t, db, strangers, day.AddDate(0, 0, 3))
	backdate(t, db, unrecorded, day.AddDate(0, 0, 4))

	// The seller: its own two people, Ani first — she typed the latest — and never the other team's, nor
	// the unrecorded one as a person 0.
	seller := listCreators(t, svc, 2, &commonv1.CommonPagination{Page: 1, Limit: 50})
	if !slices.Equal(seller.GetIds(), []uint64{ani, budi}) {
		t.Fatalf("seller's creators = %v, want [ani budi]", seller.GetIds())
	}

	if at := seller.GetItems()[0].GetCreator().GetMapData()[ani].GetLastAtUnix(); at != day.AddDate(0, 0, 2).Unix() {
		t.Fatalf("ani's last = %d, want her newer order's date", at)
	}

	// The warehouse both sellers ship from sees every one of them.
	warehouse := listCreators(t, svc, testWarehouse, &commonv1.CommonPagination{Page: 1, Limit: 50})
	if !slices.Equal(warehouse.GetIds(), []uint64{stranger, ani, budi}) {
		t.Fatalf("warehouse's creators = %v, want [stranger ani budi]", warehouse.GetIds())
	}

	// The pager counts people, not orders.
	firstTwo := listCreators(t, svc, testWarehouse, &commonv1.CommonPagination{Page: 1, Limit: 2})
	if firstTwo.GetPageInfo().GetTotalItems() != 3 || len(firstTwo.GetIds()) != 2 {
		t.Fatalf("page 1 of 2 = %v, total %d, want 2 of 3", firstTwo.GetIds(), firstTwo.GetPageInfo().GetTotalItems())
	}
}

// The "created by" filter: the rows, the pager, and the header's census agree, and the row says who.
func TestOrderList_FiltersByCreator(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const ani, budi uint64 = 7, 8

	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	anis := placeOrderAs(t, svc, asUser(ani), 2, shop)
	anis2 := placeOrderAs(t, svc, asUser(ani), 2, shop)
	placeOrderAs(t, svc, asUser(budi), 2, shop)
	placeOrderAs(t, svc, context.Background(), 2, shop)

	got := listFiltered(t, svc, 2, &sellingv1.OrderListFilter{CreatedByUserId: ani})
	wantOrders(t, got, anis, anis2)

	for _, row := range orderRows(got) {
		if row.GetCreatedByUserId() != ani {
			t.Fatalf("order %d says it was typed in by %d, want ani", row.GetId(), row.GetCreatedByUserId())
		}
	}

	// 0 is "anybody", never "the unrecorded ones".
	wantAll := listFiltered(t, svc, 2, &sellingv1.OrderListFilter{})
	if n := wantAll.GetPageInfo().GetTotalItems(); n != 4 {
		t.Fatalf("unfiltered = %d, want 4", n)
	}

	res, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: 2, Filter: &sellingv1.OrderStatFilter{CreatedByUserId: budi},
	}))
	if err != nil {
		t.Fatalf("OrderStat: %v", err)
	}

	var placed int64

	for _, row := range res.Msg.GetByStatus() {
		if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_PLACED {
			placed = row.GetCount()
		}
	}

	if placed != 1 {
		t.Fatalf("PLACED census for budi = %d, want 1 — the stat ignores the creator filter the list applies", placed)
	}
}
