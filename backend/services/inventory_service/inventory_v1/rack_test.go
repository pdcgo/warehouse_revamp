package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// createRack is the happy path, used as the fixture for the rest.
func createRack(t *testing.T, svc rackCreator, warehouse uint64, code, name string) uint64 {
	t.Helper()

	resp, err := svc.RackCreate(context.Background(), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: code, Name: name,
	}))
	if err != nil {
		t.Fatalf("RackCreate %q: %v", code, err)
	}

	return resp.Msg.GetRack().GetId()
}

// rackCreator is just enough of the service for the helper above.
type rackCreator interface {
	RackCreate(context.Context, *connect.Request[inventoryv1.RackCreateRequest]) (*connect.Response[inventoryv1.RackCreateResponse], error)
}

func TestRack_CreateAndList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse uint64 = 5

	createRack(t, svc, warehouse, "B-02-1", "Bulk shelf")
	createRack(t, svc, warehouse, "A-01-3", "Receiving bay")
	// Another warehouse's rack must not leak into this one's list.
	createRack(t, svc, 6, "A-01-3", "Someone else's bay")

	resp, err := svc.RackList(ctx, connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList: %v", err)
	}

	got := resp.Msg.GetRacks()
	if len(got) != 2 {
		t.Fatalf("racks = %d, want 2 (the other warehouse's must not appear)", len(got))
	}

	// Ordered by the label, because that is how someone walking the aisles finds it.
	if got[0].GetCode() != "A-01-3" || got[1].GetCode() != "B-02-1" {
		t.Fatalf("not code-ordered: %q, %q", got[0].GetCode(), got[1].GetCode())
	}

	if got[0].GetName() != "Receiving bay" || got[0].GetWarehouseId() != warehouse {
		t.Fatalf("unexpected rack: %+v", got[0])
	}
}

// The label is unique per warehouse — but two warehouses may each have an 'A-01-3', which the test
// above already relies on.
func TestRack_DuplicateCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRack(t, svc, 5, "A-01-3", "Bay")

	_, err := svc.RackCreate(context.Background(), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: 5, Code: "A-01-3",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

func TestRack_SearchByCodeOrName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRack(t, svc, 5, "A-01-3", "Receiving bay")
	createRack(t, svc, 5, "C-09-2", "Cold room")

	// By name.
	resp, err := svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: 5, Q: "cold", Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList (q): %v", err)
	}
	if len(resp.Msg.GetRacks()) != 1 || resp.Msg.GetRacks()[0].GetCode() != "C-09-2" {
		t.Fatalf("search by name = %+v", resp.Msg.GetRacks())
	}

	// By code — the label is what someone actually types.
	resp, err = svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: 5, Q: "A-01", Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList (code q): %v", err)
	}
	if len(resp.Msg.GetRacks()) != 1 || resp.Msg.GetRacks()[0].GetName() != "Receiving bay" {
		t.Fatalf("search by code = %+v", resp.Msg.GetRacks())
	}
}

func TestRack_Update(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := createRack(t, svc, 5, "A-01-3", "Old name")

	resp, err := svc.RackUpdate(context.Background(), connect.NewRequest(&inventoryv1.RackUpdateRequest{
		TeamId: 5, RackId: id, Name: proto.String("Re-labelled bay"), Code: proto.String("A-01-4"),
	}))
	if err != nil {
		t.Fatalf("RackUpdate: %v", err)
	}

	got := resp.Msg.GetRack()
	if got.GetName() != "Re-labelled bay" || got.GetCode() != "A-01-4" {
		t.Fatalf("unexpected after update: %+v", got)
	}
}

// A rack in warehouse 5 must be invisible to warehouse 6, by id, on every by-id RPC.
func TestRack_CrossWarehouseIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	id := createRack(t, svc, 5, "A-01-3", "Bay")

	_, err := svc.RackUpdate(ctx, connect.NewRequest(&inventoryv1.RackUpdateRequest{
		TeamId: 6, RackId: id, Name: proto.String("hijacked"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse update = %v, want NotFound", connect.CodeOf(err))
	}

	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: 6, RackId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse delete = %v, want NotFound", connect.CodeOf(err))
	}
}

// Delete is SOFT: the rack drops out of the list, and — the point of the partial unique index — its
// label is free to paint on another shelf.
func TestRack_SoftDeleteFreesTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse uint64 = 5

	id := createRack(t, svc, warehouse, "A-01-3", "Bay")

	_, err := svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouse, RackId: id,
	}))
	if err != nil {
		t.Fatalf("RackDelete: %v", err)
	}

	resp, err := svc.RackList(ctx, connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList: %v", err)
	}
	if len(resp.Msg.GetRacks()) != 0 {
		t.Fatalf("a deleted rack still lists: %+v", resp.Msg.GetRacks())
	}

	// The code is reusable now.
	createRack(t, svc, warehouse, "A-01-3", "New shelf on the same label")

	// Deleting it twice is NotFound, not a silent success.
	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouse, RackId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("re-delete = %v, want NotFound", connect.CodeOf(err))
	}
}
