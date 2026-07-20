package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// insertRack seeds an active rack in a warehouse directly and returns its id. Stock tests need a rack
// to place stock ON (#135) without going through the rack RPCs.
func insertRack(t *testing.T, db *gorm.DB, warehouseID uint64, code string) uint64 {
	t.Helper()

	r := inventory_service_models.Rack{WarehouseID: warehouseID, Code: code}

	err := db.Create(&r).Error
	if err != nil {
		t.Fatalf("insert rack: %v", err)
	}

	return r.ID
}

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

// #138 — a shelf with goods on it cannot be deleted; empty it first.
//
// This was a LIVE bug, not a hypothetical: RackDelete is a SOFT delete, so stock_levels' ON DELETE
// RESTRICT never fires, and #137 made it reachable by putting stock on shelves. Unguarded, the goods
// were STRANDED — still in stock_levels, at a location that had vanished from every list.
func TestRack_DeleteRefusedWhileItHoldsStock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse uint64 = 5

	rack := createRack(t, svc, warehouse, "A-01-3", "Aisle A")

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())`,
		warehouse, 100, rack, 40,
	).Error
	if err != nil {
		t.Fatalf("seed stock: %v", err)
	}

	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouse, RackId: rack,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("deleting a rack that holds stock = %v, want FailedPrecondition", code)
	}

	// The refusal left the rack alive — a rack half-deleted would be the worst of both.
	var deleted bool

	err = db.Raw(`SELECT deleted FROM racks WHERE id = ?`, rack).Scan(&deleted).Error
	if err != nil {
		t.Fatalf("read rack: %v", err)
	}
	if deleted {
		t.Fatal("a refused delete must not have flipped the rack")
	}

	// Empty the shelf and it deletes — the refusal is a precondition, not a life sentence.
	err = db.Exec(`UPDATE stock_levels SET on_hand = 0 WHERE rack_id = ?`, rack).Error
	if err != nil {
		t.Fatalf("empty shelf: %v", err)
	}

	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouse, RackId: rack,
	}))
	if err != nil {
		t.Fatalf("an empty rack must delete: %v", err)
	}
}

// #138 — what is on THIS shelf, and how much of each.
func TestRackStock_ListsWhatIsOnTheShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse uint64 = 5

	rackA := createRack(t, svc, warehouse, "A-01-3", "")
	rackB := createRack(t, svc, warehouse, "A-02-1", "")

	place := func(rack *uint64, product uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`,
			warehouse, product, rack, onHand,
		).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	place(&rackA, 100, 40)
	place(&rackA, 200, 7)
	place(&rackB, 100, 60) // the same product on another shelf
	place(nil, 300, 5)     // unplaced — on no shelf at all
	place(&rackA, 400, 0)  // a shelf that was counted to zero: not ON the rack

	got, err := svc.RackStock(ctx, connect.NewRequest(&inventoryv1.RackStockRequest{
		TeamId: warehouse, RackId: rackA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackStock: %v", err)
	}

	// Only what is physically on rackA: the other shelf's stock, the unplaced pile, and the zeroed
	// line are all absent. A zeroed line especially — it would show a product that is not there.
	lines := got.Msg.GetLines()
	if len(lines) != 2 {
		t.Fatalf("rack A holds 2 products, got %d: %+v", len(lines), lines)
	}

	on := map[uint64]int64{}
	for _, l := range lines {
		on[l.GetProductId()] = l.GetOnHand()
	}

	if on[100] != 40 || on[200] != 7 {
		t.Fatalf("shelf contents = %+v, want product 100 -> 40 and 200 -> 7", on)
	}

	// 40 here, not the product's 100 across the warehouse — a rack answers a different question.
	if total := got.Msg.GetPageInfo().GetTotalItems(); total != 2 {
		t.Fatalf("page total = %d, want 2", total)
	}
}

// #138 — another warehouse's rack reads as NotFound, never as an empty shelf. Those are very different
// answers: if "not yours" looked like "nothing on it", a probe could map another warehouse's rack ids
// by which of them came back empty.
func TestRackStock_CrossWarehouseIsNotFoundNotEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const mine, theirs uint64 = 5, 6

	theirRack := createRack(t, svc, theirs, "B-01-1", "")

	_, err := svc.RackStock(ctx, connect.NewRequest(&inventoryv1.RackStockRequest{
		TeamId: mine, RackId: theirRack, Page: page1(),
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("another warehouse's rack = %v, want NotFound", code)
	}

	_, err = svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: mine, RackId: theirRack,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("RackDetail cross-warehouse = %v, want NotFound", code)
	}
}

// #138 — the detail page's header.
func TestRackDetail_ReturnsTheRack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse uint64 = 5

	rack := createRack(t, svc, warehouse, "A-01-3", "Aisle A")

	got, err := svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: warehouse, RackId: rack,
	}))
	if err != nil {
		t.Fatalf("RackDetail: %v", err)
	}

	if got.Msg.GetRack().GetCode() != "A-01-3" || got.Msg.GetRack().GetName() != "Aisle A" {
		t.Fatalf("rack did not round-trip: %+v", got.Msg.GetRack())
	}

	// A deleted rack is gone from the detail page too, not a ghost you can still open.
	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouse, RackId: rack,
	}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err = svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: warehouse, RackId: rack,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("a deleted rack = %v, want NotFound", code)
	}
}
