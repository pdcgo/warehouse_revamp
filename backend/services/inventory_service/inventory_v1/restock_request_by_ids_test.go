package inventory_v1_test

import (
	"context"
	"slices"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// byIdsAnswer is one restock's part of a RestockRequestByIds answer, its slices pulled apart.
type byIdsAnswer struct {
	restock *inventoryv1.RestockRequest
	labels  *inventoryv1.RestockLabelSet
}

// restocksByIds is the read under test, sugar for the request.
func restocksByIds(
	t *testing.T,
	svc *inventory_v1.Service,
	team uint64,
	ids []uint64,
	types ...inventoryv1.RestockRequestByIdsDataType,
) map[uint64]byIdsAnswer {
	t.Helper()

	res, err := svc.RestockRequestByIds(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestByIdsRequest{
		TeamId:      team,
		Filter:      &inventoryv1.RestockRequestByIdsFilter{Ids: ids},
		DataRequest: types,
	}))
	if err != nil {
		t.Fatalf("RestockRequestByIds: %v", err)
	}

	out := map[uint64]byIdsAnswer{}
	for id, list := range res.Msg.GetItems() {
		a := out[id]
		for _, item := range list.GetItems() {
			if r := item.GetRestockRequest(); r != nil {
				if a.restock != nil {
					t.Fatalf("restock %d answered twice", id)
				}
				a.restock = r
			}

			if l := item.GetLabels(); l != nil {
				if a.labels != nil {
					t.Fatalf("restock %d's labels answered twice", id)
				}
				a.labels = l
			}
		}
		out[id] = a
	}

	return out
}

const (
	bothSlicesRestock = inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST
	bothSlicesLabels  = inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_LABELS
)

// CETAK LABEL READS EVERY RESTOCK ON THE PRINT IN ONE CALL (the-labels-mark-their-one-by-one-read) — and reads each one
// exactly as the two one-restock reads it replaces: an accepted restock's labels are RestockRequestLabels' answer, field
// for field; an arrived or ongoing one carries its lines (an arrived one prints them) and no labels; another
// warehouse's restock and an unknown id are absent, as Detail's NotFound.
func TestRestockRequestByIds_ReadsEachAsTheOneRestockReadsDo(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const seller, warehouse, other uint64 = 2, 5, 6

	staging := stagingPlacement(t, db, warehouse)
	otherStaging := stagingPlacement(t, db, other)

	rackA, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	create := func(to uint64, receipt string) *inventoryv1.RestockRequest {
		t.Helper()

		res, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: seller, WarehouseId: to, ShipmentCost: 80_000, Receipt: receipt,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, ProductCode: "KPH-001", Name: "Kaos Polos Hitam", Count: 100, Total: 4_000_000},
				{ProductId: 200, ProductCode: "TTM-207", Name: "Topi Trucker Merah", Count: 30, Total: 840_000},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return res.Msg.GetRequest()
	}

	accept := func(to, onto uint64, r *inventoryv1.RestockRequest, split bool) {
		t.Helper()

		shirts := placedOn(onto, 100)
		if split {
			shirts = []*inventoryv1.RestockPlacement{
				{PlacementId: rackA.Msg.GetRack().GetId(), Quantity: 60},
				{PlacementId: onto, Quantity: 40},
			}
		}

		_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: to, RequestId: r.GetId(), WarehouseAdditionalCost: 5_000, WarehouseAdditionalCostNote: courierNote,
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{ItemId: r.GetItems()[0].GetId(), ReceivedCount: 100, Placements: shirts},
				{
					ItemId: r.GetItems()[1].GetId(), ReceivedCount: 30, BrokenCount: 2, BrokenNote: "crushed brims",
					Placements: placedOn(onto, 28),
				},
			},
		}))
		if err != nil {
			t.Fatalf("accept: %v", err)
		}
	}

	accepted := create(warehouse, "JNE-ACC")
	accept(warehouse, staging, accepted, true)

	acceptedPlain := create(warehouse, "JNE-ACC-2")
	accept(warehouse, staging, acceptedPlain, false)

	arrived := create(warehouse, "JNT-ARR")
	_, err = svc.RestockRequestArrive(ctx, connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
		TeamId: warehouse, RequestId: arrived.GetId(),
	}))
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	ongoing := create(warehouse, "SCP-ONG")
	elsewhere := create(other, "JNE-ELSE")
	elsewhereAccepted := create(other, "JNE-ELSE-2")
	accept(other, otherStaging, elsewhereAccepted, false)

	const unknown uint64 = 9_999_999

	ids := []uint64{
		ongoing.GetId(), accepted.GetId(), unknown, arrived.GetId(), elsewhere.GetId(), acceptedPlain.GetId(),
		elsewhereAccepted.GetId(),
	}

	got := restocksByIds(t, svc, warehouse, ids, bothSlicesRestock, bothSlicesLabels)

	visible := []uint64{ongoing.GetId(), accepted.GetId(), arrived.GetId(), acceptedPlain.GetId()}
	if len(got) != len(visible) {
		t.Fatalf("answered %d restocks, want the %d going to this warehouse", len(got), len(visible))
	}

	for _, id := range []uint64{unknown, elsewhere.GetId(), elsewhereAccepted.GetId()} {
		if _, ok := got[id]; ok {
			t.Fatalf("restock %d is not this warehouse's (or unknown) and must be absent", id)
		}
	}

	for _, id := range visible {
		a := got[id]
		if a.restock == nil {
			t.Fatalf("restock %d has no RESTOCK_REQUEST item", id)
		}

		// The restock reads as Detail reads it — status, resi, and its lines (an arrived restock's labels are those).
		detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
			TeamId: warehouse, RequestId: id,
		}))
		if err != nil {
			t.Fatalf("detail %d: %v", id, err)
		}

		want := detail.Msg.GetRequest()
		if a.restock.GetStatus() != want.GetStatus() || a.restock.GetReceipt() != want.GetReceipt() {
			t.Fatalf("restock %d = %v %q, Detail says %v %q",
				id, a.restock.GetStatus(), a.restock.GetReceipt(), want.GetStatus(), want.GetReceipt())
		}

		if len(a.restock.GetItems()) != len(want.GetItems()) {
			t.Fatalf("restock %d has %d lines, Detail %d", id, len(a.restock.GetItems()), len(want.GetItems()))
		}

		for i, line := range a.restock.GetItems() {
			w := want.GetItems()[i]
			if line.GetId() != w.GetId() || line.GetProductId() != w.GetProductId() ||
				line.GetProductCode() != w.GetProductCode() || line.GetName() != w.GetName() || line.GetCount() != w.GetCount() {
				t.Fatalf("restock %d line %d = %+v, Detail %+v", id, i, line, w)
			}
		}
	}

	// The accepted ones carry Labels' answer exactly; the others carry none.
	for _, r := range []*inventoryv1.RestockRequest{accepted, acceptedPlain} {
		set := got[r.GetId()].labels
		if set == nil {
			t.Fatalf("accepted restock %d has no LABELS item", r.GetId())
		}

		one, err := labelsFor(t, svc, warehouse, r.GetId())
		if err != nil {
			t.Fatalf("labels %d: %v", r.GetId(), err)
		}

		if set.GetReceivedAtUnix() != one.GetReceivedAtUnix() || set.GetExcludedCount() != one.GetExcludedCount() {
			t.Fatalf("restock %d: by ids %d/%d, Labels %d/%d (received at / excluded)", r.GetId(),
				set.GetReceivedAtUnix(), set.GetExcludedCount(), one.GetReceivedAtUnix(), one.GetExcludedCount())
		}

		if len(set.GetLabels()) != len(one.GetLabels()) {
			t.Fatalf("restock %d: %d labels by ids, %d from Labels", r.GetId(), len(set.GetLabels()), len(one.GetLabels()))
		}

		for i := range one.GetLabels() {
			if !proto.Equal(set.GetLabels()[i], one.GetLabels()[i]) {
				t.Fatalf("restock %d label %d = %v, Labels says %v", r.GetId(), i, set.GetLabels()[i], one.GetLabels()[i])
			}
		}
	}

	if n := len(got[accepted.GetId()].labels.GetLabels()); n != 3 {
		t.Fatalf("the split restock has %d labels, want 3 (one per placement)", n)
	}
	if n := got[accepted.GetId()].labels.GetExcludedCount(); n != 2 {
		t.Fatalf("the split restock excludes %d, want the 2 broken hats", n)
	}

	for _, r := range []*inventoryv1.RestockRequest{ongoing, arrived} {
		if got[r.GetId()].labels != nil {
			t.Fatalf("restock %d is not accepted and must carry no labels", r.GetId())
		}
	}
}

// The slices are read only when asked: no data_request is the restock alone; LABELS alone answers only the accepted.
func TestRestockRequestByIds_OnlyTheSlicesAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const seller, warehouse uint64 = 2, 5

	staging := stagingPlacement(t, db, warehouse)

	create := func() *inventoryv1.RestockRequest {
		t.Helper()

		res, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: seller, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, ProductCode: "KPH-001", Name: "Kaos Polos Hitam", Count: 4, Total: 40_000},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return res.Msg.GetRequest()
	}

	accepted := create()
	_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: accepted.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: accepted.GetItems()[0].GetId(), ReceivedCount: 4, Placements: placedOn(staging, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	ongoing := create()
	ids := []uint64{accepted.GetId(), ongoing.GetId()}

	plain := restocksByIds(t, svc, warehouse, ids)
	if len(plain) != 2 || plain[accepted.GetId()].labels != nil || plain[accepted.GetId()].restock == nil {
		t.Fatalf("no data_request = %+v, want both restocks and no labels", plain)
	}

	labelsOnly := restocksByIds(t, svc, warehouse, ids, bothSlicesLabels)
	if len(labelsOnly) != 1 || labelsOnly[accepted.GetId()].restock != nil || labelsOnly[accepted.GetId()].labels == nil {
		t.Fatalf("LABELS alone = %+v, want the accepted restock's labels only", labelsOnly)
	}
}

// The read is bounded by what a print can hold: 1 to 50 ids, each once, none 0.
func TestRestockRequestByIds_TheIdsAreBounded(t *testing.T) {
	many := make([]uint64, 0, 51)
	for i := range 51 {
		many = append(many, uint64(i+1))
	}

	ok := &inventoryv1.RestockRequestByIdsRequest{TeamId: 5, Filter: &inventoryv1.RestockRequestByIdsFilter{Ids: many[:50]}}

	err := protovalidate.Validate(ok)
	if err != nil {
		t.Fatalf("50 ids: %v", err)
	}

	for name, ids := range map[string][]uint64{
		"51 ids":    many,
		"none":      {},
		"twice":     {7, 7},
		"a zero id": {0, 7},
	} {
		err = protovalidate.Validate(&inventoryv1.RestockRequestByIdsRequest{
			TeamId: 5, Filter: &inventoryv1.RestockRequestByIdsFilter{Ids: ids},
		})
		if err == nil {
			t.Fatalf("%s: accepted, want refused", name)
		}
	}
}

// Who may ask: RestockRequestLabels' readers — the warehouse side, as Cetak Label is. A read: an agent and the monitor
// may call it.
func TestRestockRequestByIds_Policy(t *testing.T) {
	roles := func(name protoreflect.FullName) []string {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatal(err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		out := []string{}
		for _, r := range policy.GetRoles() {
			out = append(out, r.String())
		}

		return out
	}

	byIds := roles("warehouse.inventory.v1.RestockRequestByIdsRequest")
	labels := roles("warehouse.inventory.v1.RestockRequestLabelsRequest")
	if !slices.Equal(byIds, labels) {
		t.Fatalf("RestockRequestByIds roles = %v, want RestockRequestLabels' %v", byIds, labels)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockRequestByIds")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockRequestByIds must be marked NO_SIDE_EFFECTS")
	}
}
