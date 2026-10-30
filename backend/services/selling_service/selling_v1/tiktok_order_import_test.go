package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func tiktokImport(t *testing.T, client sellingv1connect.OrderServiceClient, shopID uint64, content []byte) importRun {
	t.Helper()

	stream, err := client.TiktokOrderImport(context.Background(), connect.NewRequest(&sellingv1.TiktokOrderImportRequest{
		TeamId: 2, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		t.Fatalf("TiktokOrderImport: %v", err)
	}
	defer stream.Close()

	return collectImport(t, stream.Receive, func() importMessage { return stream.Msg() }, stream.Err)
}

// TikTok's 27 Oct export: Delivered and Completed both complete a shipped order, Return/Refund returns one, In transit
// ships one — and the description row under the header is not counted as an order.
func TestTiktokOrderImport_MakesCustomerServicesMovesAndListsTheRest(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A TikTok", "TOKO-A-TT", "tiktok")

	delivered := seedImportOrder(t, db, shop, "582035120938471122", "shipped")
	returned := seedImportOrder(t, db, shop, "582046653120988733", "shipped")
	inTransit := seedImportOrder(t, db, shop, "582047009875512344", "shipping")

	run := tiktokImport(t, client, shop, orderSample(t, "tiktok", "mock_all_orders_20261020_20261027.xlsx"))

	if len(run.errors) > 0 {
		t.Fatalf("errors: %v", run.errors)
	}

	if run.count != 8 {
		t.Fatalf("count %d, want 8 — the description row is not an order", run.count)
	}

	wantTally(t, run, 3, 2, 3) // the two Canceled refs have nothing live here

	for id, want := range map[uint64]string{delivered: "completed", returned: "return", inTransit: "shipped"} {
		if got := statusOf(t, db, id); got != want {
			t.Fatalf("order %d is %s, want %s", id, got, want)
		}
	}

	wantLine(t, run, "582047009875512344", "shipping → shipped (Shipped · In transit)")
}

// A Shopee shop cannot be imported through TikTok's import.
func TestTiktokOrderImport_AShopeeShopIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	run := tiktokImport(t, client, shop, orderSample(t, "tiktok", "mock_all_orders_20261020_20261027.xlsx"))

	if len(run.errors) != 1 || run.tally != nil {
		t.Fatalf("errors %v, tally %v — want one error and nothing read", run.errors, run.tally)
	}
}
