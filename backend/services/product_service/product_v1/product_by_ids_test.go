package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #138 — a warehouse must be able to name the box on its own shelf, even when the box belongs to
// somebody else's catalogue. That is the whole reason this RPC exists: a selling team's restock puts
// its product on a warehouse's rack, so "what is on this rack" reads ids the warehouse does not own.
func TestProductByIds_ResolvesAcrossTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertProduct(t, db, 2, "A-1", "Alpha")
	theirs := insertProduct(t, db, 3, "B-1", "Beta")

	// The caller is team 2 and gets team 3's product back — team_id authorizes, it does not filter.
	resp, err := svc.ProductByIds(context.Background(), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:     2,
		ProductIds: []uint64{mine, theirs},
	}))
	if err != nil {
		t.Fatalf("ProductByIds: %v", err)
	}

	byID := map[uint64]*productv1.Product{}
	for _, p := range resp.Msg.GetProducts() {
		byID[p.GetId()] = p
	}

	if len(byID) != 2 {
		t.Fatalf("resolved %d products, want 2: %+v", len(byID), resp.Msg.GetProducts())
	}

	// Each carries its OWNING team, which is how a caller can tell whose goods it is holding.
	if got := byID[theirs].GetTeamId(); got != 3 {
		t.Fatalf("another team's product came back with team_id %d, want 3", got)
	}
	if got := byID[theirs].GetName(); got != "Beta" {
		t.Fatalf("name = %q, want Beta", got)
	}
}

// An id that resolves to nothing is ABSENT, not an error: a caller holding a stock row for a product
// that has since gone is asking a reasonable question, and failing the whole lookup would blank a rack
// over one dead id.
func TestProductByIds_UnknownIdIsAbsentNotAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	real := insertProduct(t, db, 2, "A-1", "Alpha")

	resp, err := svc.ProductByIds(context.Background(), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:     2,
		ProductIds: []uint64{real, 999999},
	}))
	if err != nil {
		t.Fatalf("an unknown id must not fail the lookup: %v", err)
	}

	if len(resp.Msg.GetProducts()) != 1 || resp.Msg.GetProducts()[0].GetId() != real {
		t.Fatalf("want just the real product, got %+v", resp.Msg.GetProducts())
	}
}

// Stock outlives a catalogue entry: a shelf can hold a product someone deleted from the catalogue, and
// the rack page must still be able to name it rather than show a blank. `deleted` rides the wire so a
// caller that cares can tell.
func TestProductByIds_ResolvesADeletedProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "A-1", "Alpha")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	resp, err := svc.ProductByIds(context.Background(), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:     2,
		ProductIds: []uint64{id},
	}))
	if err != nil {
		t.Fatalf("ProductByIds: %v", err)
	}

	if len(resp.Msg.GetProducts()) != 1 {
		t.Fatalf("a deleted product must still resolve — stock outlives the catalogue entry, got %+v",
			resp.Msg.GetProducts())
	}
	if !resp.Msg.GetProducts()[0].GetDeleted() {
		t.Fatal("a deleted product must come back marked deleted, so a caller can tell")
	}
}
