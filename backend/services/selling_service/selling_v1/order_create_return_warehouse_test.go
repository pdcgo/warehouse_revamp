package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ORDER CREATE REFUSES A TEAM WITH NO RETURN WAREHOUSE (create-refuses-a-team-with-no-return-warehouse): a team with no
// `team_return_configurations` row places nothing — refused FailedPrecondition with the team named and where to set it,
// before the take — on both doors (the typed form and a draft's Promote). A draft the app PUSHES is not an order, so the
// push still lands. Team 2 is the ordering team, named "Toko Melati" by the fake namer.

const noReturnWarehouseMessage = "Toko Melati has no return warehouse set — set it on Settings › Return Warehouse " +
	"before creating an order"

// returnWarehouseRule is a selling service that names team 2 for the refusal and records its takes.
func returnWarehouseRule(t *testing.T, db *gorm.DB) (*selling_v1.Service, *fakePicker) {
	t.Helper()

	picker := &fakePicker{}

	return selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil,
		fakeNames{2: "Toko Melati"}), picker
}

func returnWarehouseOrder(shopID uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		ShipmentChannelId:     testShipmentChannel,
		IdempotencyKey:        newOrderKey(),
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		OrderExternalRefId:    "SHP-RW-1",
		TeamId:                2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items:        []*sellingv1.OrderItem{{ProductId: 1, ProductCode: "SKU1", Name: "Widget", Quantity: 1}},
	}
}

func ordersOfTeam(t *testing.T, db *gorm.DB, teamID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Model(&selling_service_models.Order{}).Where("team_id = ?", teamID).Count(&n).Error
	if err != nil {
		t.Fatalf("count orders: %v", err)
	}

	return n
}

// Refused without one — the team named, the return warehouse said to be unset, where to set it — and nothing taken or
// written. Set it, and the same order is placed.
func TestOrderCreate_ATeamWithNoReturnWarehouseIsRefusedUntilItSetsOne(t *testing.T) {
	db := san_testdb.DB(t)
	svc, picker := returnWarehouseRule(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	takeReturnWarehouse(t, db, 2)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(returnWarehouseOrder(shop)))
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if cerr.Message() != noReturnWarehouseMessage {
		t.Fatalf("message %q, want %q — the team named, and the return warehouse said to be unset", cerr.Message(),
			noReturnWarehouseMessage)
	}

	if picker.calls != 0 {
		t.Fatalf("the take ran %d times for a refused team — the check must come before anything moves", picker.calls)
	}

	if n := ordersOfTeam(t, db, 2); n != 0 {
		t.Fatalf("%d orders written for a refused team", n)
	}

	_, err = svc.TeamReturnConfigurationSet(context.Background(), connect.NewRequest(
		&sellingv1.TeamReturnConfigurationSetRequest{TeamId: 2, WarehouseId: 950},
	))
	if err != nil {
		t.Fatalf("set the return warehouse: %v", err)
	}

	placed, err := svc.OrderCreate(context.Background(), connect.NewRequest(returnWarehouseOrder(shop)))
	if err != nil {
		t.Fatalf("a team with a return warehouse is refused: %v", err)
	}

	if placed.Msg.GetOrder().GetId() == 0 || ordersOfTeam(t, db, 2) != 1 {
		t.Fatal("the order of a team with a return warehouse was not written")
	}
}

// Any return warehouse will do — not the one the order ships from (a-team-may-pick-any-return-warehouse,
// a-return-may-land-in-another-warehouse): the check asks only whether the team has one.
func TestOrderCreate_ATeamWithAnyReturnWarehouseIsPlaced(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := returnWarehouseRule(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, 2, configuredReturnWarehouse)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(returnWarehouseOrder(shop)))
	if err != nil {
		t.Fatalf("an order shipping from %d with returns to %d is refused: %v", testWarehouse, configuredReturnWarehouse, err)
	}
}

// The draft's Promote is the same door: refused the same way, and the draft stays to be promoted once the team sets
// one. The PUSH that brought the draft in is not an order create, so it is not refused.
func TestOrderCreate_ADraftsPromoteIsRefusedTooAndTheDraftStays(t *testing.T) {
	db := san_testdb.DB(t)
	svc, picker := returnWarehouseRule(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	takeReturnWarehouse(t, db, 2)

	// The app's push and the person finishing the draft both land with no return warehouse set.
	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, draftPusher, 2, draftID)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if cerr.Message() != noReturnWarehouseMessage {
		t.Fatalf("message %q, want %q", cerr.Message(), noReturnWarehouseMessage)
	}

	if picker.calls != 0 || ordersOfTeam(t, db, 2) != 0 {
		t.Fatalf("a refused Promote took %d times and wrote %d orders", picker.calls, ordersOfTeam(t, db, 2))
	}

	if draftsWithID(t, db, draftID) != 1 {
		t.Fatal("the refused Promote deleted the draft — it must wait to be promoted once the team sets one")
	}

	configureReturnWarehouse(t, db, 2, testWarehouse)

	_, err = promote(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("the Promote after the team set one: %v", err)
	}

	if draftsWithID(t, db, draftID) != 0 {
		t.Fatal("the promoted draft survived")
	}
}

// With no namer wired the sentence still names the team, by its id — the refusal is never held up by its name.
func TestOrderCreate_ATeamWithNoReturnWarehouseIsNamedByIdWithoutANamer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	takeReturnWarehouse(t, db, 2)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(returnWarehouseOrder(shop)))
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	want := "team #2 has no return warehouse set — set it on Settings › Return Warehouse before creating an order"
	if cerr.Message() != want {
		t.Fatalf("message %q, want %q", cerr.Message(), want)
	}
}
