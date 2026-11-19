package selling_v1_test

import (
	"context"
	"slices"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE BULK PICK LIST'S ORDERS (the-bulk-pick-list-prototype-is-accepted): OrderPickLines answers the ticked orders that
// ship from the caller's warehouse — each with its parcel's facts, its take's transaction and its lines, never money.

// pickOrder is one order to seed: where it ships from, its take, its status and its lines.
type pickOrder struct {
	warehouse uint64
	take      *uint64
	status    string
	ref       string
	receipt   string
	lines     []selling_service_models.OrderItem
}

// insertPickOrder writes an order of selling team 2 with its lines — money on every line, so a leak would show.
func insertPickOrder(t *testing.T, db *gorm.DB, o pickOrder) (orderID, shopID uint64) {
	t.Helper()

	shop := insertShop(t, db, 2, "Toko Ambil", "AMB-"+newOrderKey(), "shopee")

	for i := range o.lines {
		total := 99_000.5
		o.lines[i].UnitCost = 48_000.25
		o.lines[i].Total = &total
	}

	order := selling_service_models.Order{
		IdempotencyKey:     newOrderKey(),
		TeamID:             2,
		ShopID:             shop,
		WarehouseID:        o.warehouse,
		Status:             o.status,
		TransactionID:      o.take,
		OrderExternalRefID: o.ref,
		Receipt:            o.receipt,
		ShipmentChannelID:  testShipmentChannel,
		PlatformTotal:      150_000,
		TotalCost:          120_000,
		Address:            &selling_service_models.OrderAddress{CustomerName: "Budi"},
		Items:              o.lines,
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	return order.ID, shop
}

func take(id uint64) *uint64 { return &id }

func orderPickLines(t *testing.T, db *gorm.DB, teamID uint64, orderIDs ...uint64) []*sellingv1.OrderPick {
	t.Helper()

	res, err := newService(t, db).OrderPickLines(context.Background(), connect.NewRequest(&sellingv1.OrderPickLinesRequest{
		TeamId:   teamID,
		OrderIds: orderIDs,
	}))
	if err != nil {
		t.Fatalf("OrderPickLines(team %d, %v): %v", teamID, orderIDs, err)
	}

	return res.Msg.GetOrders()
}

func pickIDs(orders []*sellingv1.OrderPick) []uint64 {
	out := make([]uint64, 0, len(orders))
	for _, o := range orders {
		out = append(out, o.GetOrderId())
	}

	return out
}

// Each ticked order, IN THE ASKED ORDER (the list's), with what its parcel carries, its take's transaction and every
// line — product, code, name, quantity — in the order the lines were typed. An order that took nothing answers take 0.
func TestOrderPickLines_EachOrderWithItsLinesInTheAskedOrder(t *testing.T) {
	db := san_testdb.DB(t)

	first, firstShop := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse, take: take(70_101), status: "processed", ref: "SP-101", receipt: "JP0001",
		lines: []selling_service_models.OrderItem{
			{ProductID: 301, ProductCode: "KPH-M", Name: "Kaos Polos Hitam — M", Quantity: 2},
			{ProductID: 303, ProductCode: "TOP-01", Name: "Topi Rajut", Quantity: 1},
		},
	})
	second, _ := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse, take: take(70_102), status: "processed", ref: "SP-102",
		lines: []selling_service_models.OrderItem{{ProductID: 301, ProductCode: "KPH-M", Name: "Kaos Polos Hitam — M", Quantity: 1}},
	})
	noTake, _ := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse, status: "picked", ref: "SP-103",
		lines: []selling_service_models.OrderItem{{ProductID: 302, ProductCode: "KPP-L", Name: "Kaos Polos Putih — L", Quantity: 3}},
	})

	got := orderPickLines(t, db, testWarehouse, second, first, noTake)

	if ids := pickIDs(got); !slices.Equal(ids, []uint64{second, first, noTake}) {
		t.Fatalf("orders = %v, want the asked order %v", ids, []uint64{second, first, noTake})
	}

	one := got[1]
	if one.GetTransactionId() != 70_101 || one.GetShopId() != firstShop || one.GetOrderExternalRefId() != "SP-101" ||
		one.GetReceiptCode() != "JP0001" || one.GetShipmentChannelId() != testShipmentChannel ||
		one.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PROCESSED {
		t.Fatalf("order %d = %+v, want take 70101, its shop, ref SP-101, resi JP0001, its courier, processed", first, one)
	}

	lines := one.GetLines()
	if len(lines) != 2 ||
		lines[0].GetProductId() != 301 || lines[0].GetProductCode() != "KPH-M" ||
		lines[0].GetName() != "Kaos Polos Hitam — M" || lines[0].GetQuantity() != 2 ||
		lines[1].GetProductId() != 303 || lines[1].GetQuantity() != 1 {
		t.Fatalf("order %d's lines = %+v, want Kaos ×2 then Topi ×1", first, lines)
	}

	if got[0].GetTransactionId() != 70_102 || len(got[0].GetLines()) != 1 || got[0].GetLines()[0].GetQuantity() != 1 {
		t.Fatalf("order %d = %+v, want take 70102 with Kaos ×1", second, got[0])
	}

	if got[2].GetTransactionId() != 0 || got[2].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PICKED ||
		len(got[2].GetLines()) != 1 || got[2].GetLines()[0].GetQuantity() != 3 {
		t.Fatalf("order %d = %+v, want no take, picked, Kaos Putih ×3", noTake, got[2])
	}
}

// A WAREHOUSE READS ONLY WHAT SHIPS FROM IT: another building's order, and an id that names nothing, are left out —
// alike, so ids cannot be probed. The return warehouse's arm of the order scope is NOT here: an order in return whose
// team's return warehouse is the caller, shipped from another building, is not the caller's to pick. The root team
// reads any order.
func TestOrderPickLines_AnotherWarehousesOrderIsLeftOut(t *testing.T) {
	db := san_testdb.DB(t)

	giveReturnWarehouse(t, db, 2) // team 2 returns to testWarehouse

	mine, _ := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse, take: take(80_001), status: "processed",
		lines: []selling_service_models.OrderItem{{ProductID: 301, ProductCode: "KPH-M", Name: "Kaos", Quantity: 1}},
	})
	theirs, _ := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse + 1, take: take(80_002), status: "processed",
		lines: []selling_service_models.OrderItem{{ProductID: 302, ProductCode: "KPP-L", Name: "Kaos Putih", Quantity: 4}},
	})
	returning, _ := insertPickOrder(t, db, pickOrder{
		warehouse: testWarehouse + 1, take: take(80_003), status: "return",
		lines: []selling_service_models.OrderItem{{ProductID: 303, ProductCode: "TOP-01", Name: "Topi", Quantity: 1}},
	})

	got := orderPickLines(t, db, testWarehouse, theirs, mine, returning, 999_999_999)
	if ids := pickIDs(got); !slices.Equal(ids, []uint64{mine}) {
		t.Fatalf("warehouse %d read %v, want only its own order %d", testWarehouse, ids, mine)
	}

	if ids := pickIDs(orderPickLines(t, db, testWarehouse+1, theirs, mine, returning)); !slices.Equal(ids, []uint64{theirs, returning}) {
		t.Fatalf("warehouse %d read %v, want its own %v", testWarehouse+1, ids, []uint64{theirs, returning})
	}

	if ids := pickIDs(orderPickLines(t, db, san_auth.RootTeamID, theirs, mine)); !slices.Equal(ids, []uint64{theirs, mine}) {
		t.Fatalf("the root team read %v, want both %v", ids, []uint64{theirs, mine})
	}
}

// THE CAP: 1 to 50 ids — the warehouse list's largest page — each once and each a real id. 51 is refused before the
// handler runs, so the answer stays a detail read of the asked orders (the HARD RULE 9 exemption the proto states).
func TestOrderPickLines_FiftyIdsAtMost(t *testing.T) {
	ids := func(n int) []uint64 {
		out := make([]uint64, n)
		for i := range out {
			out[i] = uint64(i + 1)
		}

		return out
	}

	for _, ok := range [][]uint64{ids(1), ids(50)} {
		err := protovalidate.Validate(&sellingv1.OrderPickLinesRequest{TeamId: testWarehouse, OrderIds: ok})
		if err != nil {
			t.Fatalf("%d ids were refused: %v", len(ok), err)
		}
	}

	for name, bad := range map[string][]uint64{
		"none":      nil,
		"51":        ids(51),
		"twice":     {7, 7},
		"a zero id": {7, 0},
	} {
		err := protovalidate.Validate(&sellingv1.OrderPickLinesRequest{TeamId: testWarehouse, OrderIds: bad})
		if err == nil {
			t.Fatalf("%s passed validation", name)
		}
	}
}

// NO SELLER MONEY: the answer's messages carry exactly the crew's facts — a field added later (a price, a cost, the
// platform total) has to change this list on purpose.
func TestOrderPickLines_CarriesNoMoney(t *testing.T) {
	want := map[string][]string{
		"warehouse.selling.v1.OrderPick": {
			"order_id", "transaction_id", "status", "shop_id", "order_external_ref_id", "shipment_channel_id",
			"receipt_code", "lines",
		},
		"warehouse.selling.v1.OrderPickLine": {"product_id", "product_code", "name", "quantity"},
	}

	for name, fields := range want {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatal(err)
		}

		got := []string{}
		all := desc.(protoreflect.MessageDescriptor).Fields()
		for i := range all.Len() {
			got = append(got, string(all.Get(i).Name()))
		}

		if !slices.Equal(got, fields) {
			t.Fatalf("%s fields = %v, want exactly %v", name, got, fields)
		}
	}
}

// Who may ask: the warehouse crew and Root and the Administrator, scoped to the warehouse — never a selling role. A
// read: an agent and the monitor may call it.
func TestOrderPickLines_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderPickLinesRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("OrderPickLinesRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	scope, ok := san_auth.ScopeOf(&sellingv1.OrderPickLinesRequest{TeamId: 77, OrderIds: []uint64{9}})
	if !ok || scope != 77 {
		t.Fatalf("scope = %d (ok %v), want the warehouse 77", scope, ok)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderService.OrderPickLines")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("OrderPickLines must be marked NO_SIDE_EFFECTS")
	}
}
