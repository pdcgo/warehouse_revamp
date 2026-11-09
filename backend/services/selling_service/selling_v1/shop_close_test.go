package selling_v1_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// closeShop is ShopClose as a test needs it — the answer, or the test stops.
func closeShop(t *testing.T, svc *selling_v1.Service, teamID, shopID uint64) *sellingv1.Shop {
	t.Helper()

	res, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{
		TeamId: teamID, ShopId: shopID,
	}))
	if err != nil {
		t.Fatalf("ShopClose(%d): %v", shopID, err)
	}

	return res.Msg.GetShop()
}

// storedShop is the shop's row as committed to this test's transaction.
func storedShop(t *testing.T, db *gorm.DB, shopID uint64) selling_service_models.Shop {
	t.Helper()

	var shop selling_service_models.Shop

	err := db.First(&shop, shopID).Error
	if err != nil {
		t.Fatalf("read shop %d: %v", shopID, err)
	}

	return shop
}

// lifecyclePolicy asserts a request's roles: the team's owner and admin, and root or the administrator — the managers
// who wrote shops before (managers-write-shops-and-cs-reads-them, a-closed-shop-locks-all-but-its-grants). Never CS.
func lifecyclePolicy(t *testing.T, fullName string) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(fullName))
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("%s has no policy", fullName)
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("%s roles = %v, want %v", fullName, policy.GetRoles(), want)
	}
}

// Who closes: the owner and admin, root and the administrator — never customer service.
func TestShopClose_Policy(t *testing.T) {
	lifecyclePolicy(t, "warehouse.selling.v1.ShopCloseRequest")
}

// A close sets the status and the close date, answers the shop as it now is — its primary CS too — and drops it from
// the default list (a-shop-is-closed-never-deleted). The row is still there: nothing is deleted.
func TestShopClose_ClosesAndLeavesTheDefaultList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Store", "MLT", "shopee")
	grantShop(t, db, id, 10, true)

	got := closeShop(t, svc, 2, id)

	if got.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_CLOSED || got.GetClosedAtUnix() == 0 {
		t.Fatalf("answer status %v closed at %d, want CLOSED with a date", got.GetStatus(), got.GetClosedAtUnix())
	}

	if got.GetPrimaryUserId() != 10 {
		t.Errorf("answer primary = %d, want 10 — the close leaves the grants as they are", got.GetPrimaryUserId())
	}

	row := storedShop(t, db, id)
	if row.Status != selling_service_models.ShopClosed || row.ClosedAt == nil {
		t.Fatalf("stored status %q closed at %v, want closed with a date", row.Status, row.ClosedAt)
	}

	names, _ := shopNames(t, svc, nil)
	if len(names) != 0 {
		t.Fatalf("the default list still shows %v — it shows open shops only", names)
	}
}

// IDEMPOTENT: a second close answers the shop as it is, and its close date does not move.
func TestShopClose_TwiceIsOneClose(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Store", "MLT", "shopee")

	first := closeShop(t, svc, 2, id)

	err := db.Exec(`UPDATE shops SET closed_at = closed_at - interval '1 day' WHERE id = ?`, id).Error
	if err != nil {
		t.Fatalf("age the close: %v", err)
	}

	aged := storedShop(t, db, id).ClosedAt

	second := closeShop(t, svc, 2, id)

	if second.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_CLOSED {
		t.Fatalf("second close status = %v", second.GetStatus())
	}

	if second.GetClosedAtUnix() != aged.Unix() || second.GetClosedAtUnix() == first.GetClosedAtUnix() {
		t.Fatalf("the second close moved the date: %d, want the first close's %d", second.GetClosedAtUnix(), aged.Unix())
	}
}

// Another team's shop, or none, is NotFound — and the shop is left open.
func TestShopClose_AnotherTeamsShopIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Team 2 shop", "S2", "shopee")

	for _, tc := range []struct {
		name         string
		team, shopID uint64
	}{
		{"another team's", 3, id},
		{"none", 2, 999_999},
	} {
		_, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{
			TeamId: tc.team, ShopId: tc.shopID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: code = %v, want NotFound", tc.name, connect.CodeOf(err))
		}
	}

	if storedShop(t, db, id).Status != selling_service_models.ShopOpen {
		t.Fatal("a refused close closed the shop")
	}
}

// Closing frees the code (a-shop-code-is-unique-among-open-shops): a new shop takes it.
func TestShopClose_FreesTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Lama", "MLT", "shopee")

	// The refused insert aborts the test's one transaction — held inside a savepoint so the test goes on.
	err := db.Exec(`SAVEPOINT clash`).Error
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}

	_, err = svc.ShopCreate(context.Background(), connect.NewRequest(&sellingv1.ShopCreateRequest{
		TeamId: 2, Name: "Melati Baru", ShopCode: "MLT", Marketplace: 1,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a second open shop on the code: %v, want AlreadyExists", err)
	}

	err = db.Exec(`ROLLBACK TO SAVEPOINT clash`).Error
	if err != nil {
		t.Fatalf("rollback to savepoint: %v", err)
	}

	closeShop(t, svc, 2, id)

	res, err := svc.ShopCreate(context.Background(), connect.NewRequest(&sellingv1.ShopCreateRequest{
		TeamId: 2, Name: "Melati Baru", ShopCode: "MLT", Marketplace: 1,
	}))
	if err != nil {
		t.Fatalf("a new shop on the freed code: %v", err)
	}

	if res.Msg.GetShop().GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_OPEN {
		t.Errorf("a new shop's status = %v, want OPEN", res.Msg.GetShop().GetStatus())
	}
}

// THE DRAFTS WAIT (a-close-leaves-the-drafts-waiting): the close goes through with a draft on the shop, the draft is
// still there, finalizing it is refused — "the shop is closed", no stock taken — and once the shop is reopened the same
// draft becomes its order.
func TestShopClose_LeavesTheDraftsWaitingUntilTheShopReopens(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)

	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	draftID := readyDraft(t, svc, db, shop)

	closeShop(t, svc, 2, shop)

	if draftsWithID(t, db, draftID) != 1 {
		t.Fatal("the close removed the shop's draft")
	}

	_, err := promote(t, svc, draftPusher, 2, draftID)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "the shop is closed") {
		t.Fatalf("promote on a closed shop: %v, want FailedPrecondition, the shop is closed", err)
	}

	if picker.calls != 0 || draftsWithID(t, db, draftID) != 1 {
		t.Fatalf("a refused promote took stock (%d) or used the draft (%d left)", picker.calls, draftsWithID(t, db, draftID))
	}

	_, err = svc.ShopReopen(context.Background(), connect.NewRequest(&sellingv1.ShopReopenRequest{TeamId: 2, ShopId: shop}))
	if err != nil {
		t.Fatalf("ShopReopen: %v", err)
	}

	order, err := promote(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("promote after the reopen: %v", err)
	}

	if order.GetShopId() != shop || draftsWithID(t, db, draftID) != 0 {
		t.Fatalf("after the reopen: order on shop %d, %d drafts left — want the draft become its order",
			order.GetShopId(), draftsWithID(t, db, draftID))
	}
}
