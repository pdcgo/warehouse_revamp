package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func reopenShop(svc *selling_v1.Service, teamID, shopID uint64) (*sellingv1.Shop, error) {
	res, err := svc.ShopReopen(context.Background(), connect.NewRequest(&sellingv1.ShopReopenRequest{
		TeamId: teamID, ShopId: shopID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetShop(), nil
}

// Who reopens: the same managers who close.
func TestShopReopen_Policy(t *testing.T) {
	lifecyclePolicy(t, "warehouse.selling.v1.ShopReopenRequest")
}

// A reopen gives the shop back: open, no close date, in the default list again (a-shop-is-closed-never-deleted).
func TestShopReopen_OpensItAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Store", "MLT", "shopee")
	closeShop(t, svc, 2, id)

	got, err := reopenShop(svc, 2, id)
	if err != nil {
		t.Fatalf("ShopReopen: %v", err)
	}

	if got.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_OPEN || got.GetClosedAtUnix() != 0 {
		t.Fatalf("answer status %v closed at %d, want OPEN with no date", got.GetStatus(), got.GetClosedAtUnix())
	}

	row := storedShop(t, db, id)
	if row.Status != selling_service_models.ShopOpen || row.ClosedAt != nil {
		t.Fatalf("stored status %q closed at %v, want open with none", row.Status, row.ClosedAt)
	}

	names, _ := shopNames(t, svc, nil)
	if len(names) != 1 || names[0] != "Melati Store" {
		t.Fatalf("the default list = %v, want the reopened shop", names)
	}
}

// IDEMPOTENT: reopening an open shop answers it as it is.
func TestShopReopen_AnOpenShopIsAnsweredAsItIs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Store", "MLT", "shopee")
	before := storedShop(t, db, id)

	got, err := reopenShop(svc, 2, id)
	if err != nil {
		t.Fatalf("ShopReopen on an open shop: %v", err)
	}

	if got.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_OPEN {
		t.Fatalf("status = %v, want OPEN", got.GetStatus())
	}

	if !storedShop(t, db, id).UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatal("reopening an open shop wrote it")
	}
}

// THE CODE CLASH (a-shop-code-is-unique-among-open-shops): the closed shop's code was taken by a new open shop, so the
// reopen is refused — FailedPrecondition, NAMING the open shop that holds it — and the shop stays closed. Renaming the
// holder's code lets the reopen through.
func TestShopReopen_RefusedWhileAnOpenShopHoldsTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	old := insertShop(t, db, 2, "Melati Lama", "MLT", "shopee")
	closeShop(t, svc, 2, old)

	holder := insertShop(t, db, 2, "Melati Baru", "MLT", "shopee")
	// The same code in ANOTHER team is no clash.
	insertShop(t, db, 3, "Other Team", "MLT", "shopee")

	_, err := reopenShop(svc, 2, old)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("reopen on a held code: %v, want FailedPrecondition", err)
	}

	for _, word := range []string{"Melati Baru", "MLT", "rename"} {
		if !strings.Contains(err.Error(), word) {
			t.Errorf("message %q should say %q", err.Error(), word)
		}
	}

	if storedShop(t, db, old).Status != selling_service_models.ShopClosed {
		t.Fatal("a refused reopen opened the shop")
	}

	_, err = svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 2, ShopId: holder, ShopCode: proto.String("MLT-2"),
	}))
	if err != nil {
		t.Fatalf("rename the holder: %v", err)
	}

	_, err = reopenShop(svc, 2, old)
	if err != nil {
		t.Fatalf("reopen after the holder was renamed: %v", err)
	}
}

// Another team's shop, or none, is NotFound.
func TestShopReopen_AnotherTeamsShopIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Team 2 shop", "S2", "shopee")
	closeShop(t, svc, 2, id)

	for _, tc := range []struct {
		name         string
		team, shopID uint64
	}{
		{"another team's", 3, id},
		{"none", 2, 999_999},
	} {
		_, err := reopenShop(svc, tc.team, tc.shopID)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: code = %v, want NotFound", tc.name, connect.CodeOf(err))
		}
	}

	if storedShop(t, db, id).Status != selling_service_models.ShopClosed {
		t.Fatal("a refused reopen opened the shop")
	}
}
