package selling_v1_test

import (
	"context"
	"slices"
	"strconv"
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
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE PRINT PAGE'S ORDERS (the-print-page-and-the-courier-count-prototype-is-accepted): OrderPrintByIds answers the
// orders ticked for Cetak Resi that ship from the caller's warehouse — each line's facts and whether a label is attached,
// in ONE statement, never money.

// printOrder is one order to seed: where it ships from, its step, its parcel's facts and its label file ("" = none).
type printOrder struct {
	warehouse uint64
	status    string
	ref       string
	receipt   string
	document  string
}

// insertPrintOrder writes an order of selling team 2 — money on it, so a leak would show.
func insertPrintOrder(t *testing.T, db *gorm.DB, o printOrder) (orderID, shopID uint64) {
	t.Helper()

	shop := insertShop(t, db, 2, "Toko Cetak", "CTK-"+newOrderKey(), "shopee")

	order := selling_service_models.Order{
		IdempotencyKey:     newOrderKey(),
		TeamID:             2,
		ShopID:             shop,
		WarehouseID:        o.warehouse,
		Status:             o.status,
		OrderExternalRefID: o.ref,
		Receipt:            o.receipt,
		ReceiptDocumentID:  o.document,
		ShipmentChannelID:  testShipmentChannel,
		PlatformTotal:      150_000,
		GoodsCost:          90_000,
		TotalCost:          120_000,
		Address:            &selling_service_models.OrderAddress{CustomerName: "Budi"},
	}

	if o.document != "" {
		order.ReceiptFilename = "label.pdf"
		order.ReceiptMimeType = "application/pdf"
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	return order.ID, shop
}

func orderPrintByIds(t *testing.T, db *gorm.DB, teamID uint64, orderIDs ...uint64) []*sellingv1.OrderPrint {
	t.Helper()

	res, err := newService(t, db).OrderPrintByIds(context.Background(), connect.NewRequest(&sellingv1.OrderPrintByIdsRequest{
		TeamId:   teamID,
		OrderIds: orderIDs,
	}))
	if err != nil {
		t.Fatalf("OrderPrintByIds(team %d, %v): %v", teamID, orderIDs, err)
	}

	return res.Msg.GetOrders()
}

func printIDs(orders []*sellingv1.OrderPrint) []uint64 {
	out := make([]uint64, 0, len(orders))
	for _, o := range orders {
		out = append(out, o.GetOrderId())
	}

	return out
}

// Each chosen order, IN THE ASKED ORDER (the list's, which is the print's), with its step, shop, ref, courier and resi —
// and whether a label is attached: an order with none answers false, so the page names it before the print.
func TestOrderPrintByIds_EachOrderInTheAskedOrder(t *testing.T) {
	db := san_testdb.DB(t)

	labelled, labelledShop := insertPrintOrder(t, db, printOrder{
		warehouse: testWarehouse, status: "pending", ref: "SP-201", receipt: "JP0201", document: "doc-201",
	})
	bare, bareShop := insertPrintOrder(t, db, printOrder{warehouse: testWarehouse, status: "pending", ref: "SP-202"})
	reprint, _ := insertPrintOrder(t, db, printOrder{
		warehouse: testWarehouse, status: "processed", ref: "SP-203", receipt: "JP0203", document: "doc-203",
	})

	got := orderPrintByIds(t, db, testWarehouse, bare, reprint, labelled)

	if ids := printIDs(got); !slices.Equal(ids, []uint64{bare, reprint, labelled}) {
		t.Fatalf("orders = %v, want the asked order %v", ids, []uint64{bare, reprint, labelled})
	}

	one := got[2]
	if !one.GetHasLabel() || one.GetShopId() != labelledShop || one.GetOrderExternalRefId() != "SP-201" ||
		one.GetReceiptCode() != "JP0201" || one.GetShipmentChannelId() != testShipmentChannel ||
		one.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("order %d = %+v, want a label, its shop, ref SP-201, resi JP0201, its courier, pending", labelled, one)
	}

	if got[0].GetHasLabel() || got[0].GetShopId() != bareShop || got[0].GetReceiptCode() != "" {
		t.Fatalf("order %d = %+v, want NO label, its shop, no resi", bare, got[0])
	}

	if !got[1].GetHasLabel() || got[1].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PROCESSED {
		t.Fatalf("order %d = %+v, want a label, processed", reprint, got[1])
	}
}

// A WAREHOUSE READS ONLY WHAT SHIPS FROM IT — OrderLabels' own check: another building's order, and an id that names
// nothing, are left out, alike. The return warehouse's arm of the order scope is NOT here: an order in return whose team
// returns to the caller, shipped from another building, is not the caller's to print. The root team reads any order.
func TestOrderPrintByIds_AnotherWarehousesOrderIsLeftOut(t *testing.T) {
	db := san_testdb.DB(t)

	giveReturnWarehouse(t, db, 2) // team 2 returns to testWarehouse

	mine, _ := insertPrintOrder(t, db, printOrder{warehouse: testWarehouse, status: "pending", document: "doc-m"})
	theirs, _ := insertPrintOrder(t, db, printOrder{warehouse: testWarehouse + 1, status: "pending", document: "doc-t"})
	returning, _ := insertPrintOrder(t, db, printOrder{warehouse: testWarehouse + 1, status: "return"})

	got := orderPrintByIds(t, db, testWarehouse, theirs, mine, returning, 999_999_999)
	if ids := printIDs(got); !slices.Equal(ids, []uint64{mine}) {
		t.Fatalf("warehouse %d read %v, want only its own order %d", testWarehouse, ids, mine)
	}

	if ids := printIDs(orderPrintByIds(t, db, testWarehouse+1, theirs, mine, returning)); !slices.Equal(ids, []uint64{theirs, returning}) {
		t.Fatalf("warehouse %d read %v, want its own %v", testWarehouse+1, ids, []uint64{theirs, returning})
	}

	if ids := printIDs(orderPrintByIds(t, db, san_auth.RootTeamID, theirs, mine)); !slices.Equal(ids, []uint64{theirs, mine}) {
		t.Fatalf("the root team read %v, want both %v", ids, []uint64{theirs, mine})
	}
}

// MANY IDS, ONE STATEMENT: a full page of 50 chosen orders comes back whole, in the asked order (here newest first), from
// one read of the orders by primary key — never one per order, which is the interim read this replaces.
func TestOrderPrintByIds_FiftyInOneStatement(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	asked := make([]uint64, 0, 50)
	for i := range 50 {
		document := ""
		if i%2 == 0 {
			document = "doc-" + strconv.Itoa(i)
		}

		id, _ := insertPrintOrder(t, db, printOrder{warehouse: testWarehouse, status: "pending", document: document})
		asked = append([]uint64{id}, asked...)
	}

	probe.Reset()

	got := orderPrintByIds(t, db, testWarehouse, asked...)

	if ids := printIDs(got); !slices.Equal(ids, asked) {
		t.Fatalf("read %d orders %v, want all 50 in the asked order", len(ids), ids)
	}

	labelled := 0
	for _, o := range got {
		if o.GetHasLabel() {
			labelled++
		}
	}

	if labelled != 25 {
		t.Fatalf("%d orders read with a label, want 25", labelled)
	}

	if n := probe.Count(); n != 1 {
		t.Fatalf("%d statements for 50 orders, want 1: %v", n, probe.Queries())
	}
}

// THE CAP: 1 to 50 ids — OrderLabels' cap, the warehouse list's largest page — each once and each a real id. 51 is refused
// before the handler runs, so the answer stays a detail read of the asked orders.
func TestOrderPrintByIds_FiftyIdsAtMost(t *testing.T) {
	ids := func(n int) []uint64 {
		out := make([]uint64, n)
		for i := range out {
			out[i] = uint64(i + 1)
		}

		return out
	}

	for _, ok := range [][]uint64{ids(1), ids(50)} {
		err := protovalidate.Validate(&sellingv1.OrderPrintByIdsRequest{TeamId: testWarehouse, OrderIds: ok})
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
		err := protovalidate.Validate(&sellingv1.OrderPrintByIdsRequest{TeamId: testWarehouse, OrderIds: bad})
		if err == nil {
			t.Fatalf("%s passed validation", name)
		}
	}

	err := protovalidate.Validate(&sellingv1.OrderPrintByIdsRequest{OrderIds: ids(1)})
	if err == nil {
		t.Fatal("no team passed validation")
	}
}

// NO SELLER MONEY, NO FILE ID (a-warehouse-sees-no-seller-money): the answer carries exactly the print page's facts — a
// field added later (a price, a cost, the document id) has to change this list on purpose.
func TestOrderPrintByIds_CarriesNoMoney(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderPrint")
	if err != nil {
		t.Fatal(err)
	}

	got := []string{}
	all := desc.(protoreflect.MessageDescriptor).Fields()
	for i := range all.Len() {
		got = append(got, string(all.Get(i).Name()))
	}

	want := []string{
		"order_id", "status", "shop_id", "order_external_ref_id", "shipment_channel_id", "receipt_code", "has_label",
		// Cetak ulang label (a-changed-label-asks-the-warehouse-to-reprint) — a flag, not money.
		"reprint_label",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("OrderPrint fields = %v, want exactly %v", got, want)
	}
}

// Who may ask: the warehouse crew and Root and the Administrator — OrderLabels' roles — scoped to the warehouse, never a
// selling role. A read: an agent and the monitor may call it.
func TestOrderPrintByIds_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderPrintByIdsRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("OrderPrintByIdsRequest has no policy")
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

	scope, ok := san_auth.ScopeOf(&sellingv1.OrderPrintByIdsRequest{TeamId: 77, OrderIds: []uint64{9}})
	if !ok || scope != 77 {
		t.Fatalf("scope = %d (ok %v), want the warehouse 77", scope, ok)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderService.OrderPrintByIds")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("OrderPrintByIds must be marked NO_SIDE_EFFECTS")
	}
}
