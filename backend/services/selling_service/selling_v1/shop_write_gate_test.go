package selling_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// grantShop gives a user a shop, as ShopUserAdd leaves it — written directly, so a gate test seeds only the grant.
func grantShop(t *testing.T, db *gorm.DB, shopID, userID uint64, primary bool) {
	t.Helper()

	grantAt(t, db, shopID, userID, primary, time.Now())
}

// The cast of the write gate (a-write-needs-a-grant-or-a-manager), in team 2.
const (
	gateTeam      = 2
	gateGranted   = 10 // a CS granted the shop
	gateCS        = 11 // a CS of the team, granted nothing
	gateOwner     = 12
	gateTeamAdmin = 13
	gateRoot      = 14
	gateAdmin     = 15 // the system administrator, in the root team
)

func gateRoles() fakeRoles {
	return fakeRoles{
		{gateGranted, gateTeam}:          role_basev1.Role_ROLE_SELLING_CS,
		{gateCS, gateTeam}:               role_basev1.Role_ROLE_SELLING_CS,
		{gateOwner, gateTeam}:            role_basev1.Role_ROLE_SELLING_OWNER,
		{gateTeamAdmin, gateTeam}:        role_basev1.Role_ROLE_SELLING_ADMIN,
		{gateRoot, san_auth.RootTeamID}:  role_basev1.Role_ROLE_ROOT,
		{gateAdmin, san_auth.RootTeamID}: role_basev1.Role_ROLE_ADMINISTRATOR,
	}
}

// gateCreate is OrderCreate on a shop as a user — 0 = a call with no identity at all.
func gateCreate(svc *selling_v1.Service, userID, shopID uint64) error {
	ctx := context.Background()
	if userID != 0 {
		ctx = asUser(userID)
	}

	_, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		IdempotencyKey:        newOrderKey(),
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                gateTeam, ShopId: shopID, WarehouseId: testWarehouse,
		OrderExternalRefId: "GATE-" + newOrderKey(),
		CustomerName:       "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, ProductCode: "SKU1", Name: "Widget", Quantity: 1},
		},
	}))

	return err
}

// OrderCreate — and so a draft's Promote, the same door — writes only on a shop the caller is granted or runs: a grant,
// the team's owner or admin, root or the administrator. A CS of the team without a grant is refused PermissionDenied,
// naming the shop in the importer's words, and nothing is taken; a call with no caller is refused the same way.
func TestOrderCreate_NeedsAGrantOrAManager(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	shop := insertShop(t, db, gateTeam, "Melati Store", "MLT", "shopee")
	grantShop(t, db, shop, gateGranted, true)

	for _, tc := range []struct {
		name string
		user uint64
		want connect.Code
	}{
		{"granted the shop", gateGranted, 0},
		{"the team's owner, no grant", gateOwner, 0},
		{"the team's admin, no grant", gateTeamAdmin, 0},
		{"root, no grant", gateRoot, 0},
		{"the administrator, no grant", gateAdmin, 0},
		{"a CS of the team, no grant", gateCS, connect.CodePermissionDenied},
		{"no caller at all", 0, connect.CodePermissionDenied},
	} {
		before := picker.calls

		err := gateCreate(svc, tc.user, shop)
		if connect.CodeOf(err) != tc.want && !(tc.want == 0 && err == nil) {
			t.Errorf("%s: code = %v (%v), want %v", tc.name, connect.CodeOf(err), err, tc.want)

			continue
		}

		if tc.want == connect.CodePermissionDenied {
			if !strings.Contains(err.Error(), "You have no access to Melati Store") {
				t.Errorf("%s: message %q should name the shop", tc.name, err.Error())
			}

			if picker.calls != before {
				t.Errorf("%s: a refused order took stock", tc.name)
			}
		}
	}
}

// A closed shop takes no new order — not even from its owner — FailedPrecondition, naming it, before any
// stock moves (a-closed-shop-refuses-only-new-selling). Another team's shop is still NotFound.
func TestOrderCreate_AClosedShopOrAnotherTeamsIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	closed := insertShop(t, db, gateTeam, "Gone Store", "GONE", "shopee")
	grantShop(t, db, closed, gateGranted, true)

	_, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: gateTeam, ShopId: closed}))
	if err != nil {
		t.Fatalf("ShopClose: %v", err)
	}

	foreign := insertShop(t, db, 3, "Other Team", "OTH", "shopee")

	for _, user := range []uint64{gateGranted, gateOwner} {
		err = gateCreate(svc, user, closed)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "Gone Store") {
			t.Errorf("user %d on a closed shop: %v, want FailedPrecondition naming it", user, err)
		}
	}

	err = gateCreate(svc, gateOwner, foreign)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("another team's shop: %v, want NotFound", err)
	}

	if picker.calls != 0 {
		t.Errorf("a refused order took stock %d times", picker.calls)
	}
}

// The third-party app's push writes on the shop it names: refused without a grant or a manager role, and on a closed
// shop (a-closed-shop-refuses-only-new-selling). A push naming no shop yet writes on none and goes through.
func TestOrderDraftPush_NeedsAGrantOrAManager(t *testing.T) {
	db := san_testdb.DB(t)
	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	shop := insertShop(t, db, gateTeam, "Melati Store", "MLT", "shopee")
	grantShop(t, db, shop, gateGranted, true)

	closed := insertShop(t, db, gateTeam, "Gone Store", "GONE", "shopee")

	_, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: gateTeam, ShopId: closed}))
	if err != nil {
		t.Fatalf("ShopClose: %v", err)
	}

	pushOn := func(user, shopID uint64, ref string) error {
		req := scrape()
		req.ExternalId = ref
		req.ShopId = shopID

		_, err := svc.OrderDraftPush(asUser(user), connect.NewRequest(req))

		return err
	}

	for _, tc := range []struct {
		name       string
		user, shop uint64
		want       connect.Code
	}{
		{"granted the shop", gateGranted, shop, 0},
		{"the team's owner", gateOwner, shop, 0},
		{"no shop yet", gateCS, 0, 0},
		{"a CS without a grant", gateCS, shop, connect.CodePermissionDenied},
		{"a closed shop", gateOwner, closed, connect.CodeFailedPrecondition},
	} {
		err := pushOn(tc.user, tc.shop, "SHP-"+tc.name)
		if connect.CodeOf(err) != tc.want && !(tc.want == 0 && err == nil) {
			t.Errorf("%s: code = %v (%v), want %v", tc.name, connect.CodeOf(err), err, tc.want)
		}
	}
}

// Setting a draft's shop is a write on it — a draft never holds a shop it could not become an order on. Clearing it,
// or an edit that leaves the shop alone, asks nothing.
func TestOrderDraftUpdate_SettingTheShopNeedsAGrantOrAManager(t *testing.T) {
	db := san_testdb.DB(t)
	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	shop := insertShop(t, db, gateTeam, "Melati Store", "MLT", "shopee")
	grantShop(t, db, shop, gateGranted, true)

	edit := func(user uint64, shopID *uint64) error {
		draft := push(t, svc, user, scrape()).GetDraft()

		_, err := svc.OrderDraftUpdate(asUser(user), connect.NewRequest(&sellingv1.OrderDraftUpdateRequest{
			TeamId: gateTeam, DraftId: draft.GetId(), ShopId: shopID, CustomerName: str("Ani"),
		}))

		return err
	}

	err := edit(gateGranted, u64(shop))
	if err != nil {
		t.Errorf("granted: %v", err)
	}

	err = edit(gateCS, u64(shop))
	if connect.CodeOf(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "Melati Store") {
		t.Errorf("a CS without a grant: %v, want PermissionDenied naming the shop", err)
	}

	err = edit(gateCS, u64(0))
	if err != nil {
		t.Errorf("clearing the shop: %v", err)
	}

	err = edit(gateCS, nil)
	if err != nil {
		t.Errorf("an edit leaving the shop alone: %v", err)
	}
}

// The picker's question: ShopList `writable` answers the shops the CALLER may write on — the granted ones for a CS,
// every one for a manager — while the unfiltered list stays team-wide (reads are not gated).
func TestShopList_WritableIsTheCallersShops(t *testing.T) {
	db := san_testdb.DB(t)
	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	a := insertShop(t, db, gateTeam, "Shop A", "SA", "shopee")
	b := insertShop(t, db, gateTeam, "Shop B", "SB", "shopee")
	grantShop(t, db, a, gateGranted, true)

	list := func(user uint64, writable bool) []uint64 {
		res, err := svc.ShopList(asUser(user), connect.NewRequest(&sellingv1.ShopListRequest{
			TeamId: gateTeam,
			Filter: &sellingv1.ShopListFilter{Writable: writable},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("ShopList(user %d, writable %v): %v", user, writable, err)
		}

		return res.Msg.GetIds()
	}

	for _, tc := range []struct {
		name     string
		user     uint64
		writable bool
		want     []uint64
	}{
		{"granted A, writable", gateGranted, true, []uint64{a}},
		{"granted nothing, writable", gateCS, true, nil},
		{"the owner, writable", gateOwner, true, []uint64{b, a}},
		{"root, writable", gateRoot, true, []uint64{b, a}},
		{"granted A, every shop", gateGranted, false, []uint64{b, a}},
	} {
		got := list(tc.user, tc.writable)
		if !sameIDs(got, tc.want) {
			t.Errorf("%s: ids = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func sameIDs(got, want []uint64) bool {
	if len(got) != len(want) {
		return false
	}

	seen := map[uint64]bool{}
	for _, id := range got {
		seen[id] = true
	}

	for _, id := range want {
		if !seen[id] {
			return false
		}
	}

	return true
}

// A CLOSE THAT LANDS AFTER THE GATE: OrderCreate's gate reads the shop open, the shop is closed while the stock is
// being taken, and the order's own transaction reads it again — refused, "the shop is closed", nothing written, the
// take released (refuseClosedShopInTx). The committed race of the same is TestRace_ShopClose_OrderCreate.
func TestOrderCreate_AShopClosedDuringTheTakeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)

	var svc *selling_v1.Service

	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	picker := &fakePicker{onPick: func(context.Context) { closeShop(t, svc, 2, shop) }}
	svc = newServiceWithPicker(t, db, picker)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		IdempotencyKey:        newOrderKey(),
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                2, ShopId: shop, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items:        []*sellingv1.OrderItem{{ProductId: 41, ProductCode: "SKU41", Name: "Kaos", Quantity: 1}},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "the shop is closed") {
		t.Fatalf("an order on a shop closed mid-take: %v, want FailedPrecondition, the shop is closed", err)
	}

	var orders int64

	db.Model(&selling_service_models.Order{}).Where("shop_id = ?", shop).Count(&orders)

	if orders != 0 {
		t.Fatalf("%d orders written on the closed shop", orders)
	}

	if len(picker.picked) != 1 || len(picker.returned) != 1 || picker.returned[0] != picker.picked[0] {
		t.Fatalf("picked %v, returned %v — want the take released by its key", picker.picked, picker.returned)
	}
}
