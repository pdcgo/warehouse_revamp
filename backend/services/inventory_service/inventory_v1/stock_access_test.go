package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #147 — a warehouse grants a selling team the right to draw its stock, and takes it back.
func TestStockAccess_GrantListRevoke(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse, sellingA, sellingB uint64 = 5, 2, 3

	for _, team := range []uint64{sellingA, sellingB} {
		_, err := svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
			TeamId: warehouse, SellingTeamId: team,
		}))
		if err != nil {
			t.Fatalf("grant to %d: %v", team, err)
		}
	}

	list := func() []*inventoryv1.StockAccessGrant {
		t.Helper()

		resp, err := svc.StockAccessList(ctx, connect.NewRequest(&inventoryv1.StockAccessListRequest{
			TeamId: warehouse, Page: page1(),
		}))
		if err != nil {
			t.Fatalf("list: %v", err)
		}

		return resp.Msg.GetGrants()
	}

	if got := list(); len(got) != 2 {
		t.Fatalf("granted 2, list returned %d: %+v", len(got), got)
	}

	// Revoked by the PAIR — "stop letting team 2 draw from us" is the sentence a person means.
	_, err := svc.StockAccessRevoke(ctx, connect.NewRequest(&inventoryv1.StockAccessRevokeRequest{
		TeamId: warehouse, SellingTeamId: sellingA,
	}))
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// A revoked arrangement is not an answer to "who can take our stock right now".
	got := list()
	if len(got) != 1 || got[0].GetSellingTeamId() != sellingB {
		t.Fatalf("after revoke, list = %+v, want only team %d", got, sellingB)
	}

	// Revoking again is NotFound, not a silent success: a caller must not be told "they can no longer
	// draw from you" when they already could not.
	_, err = svc.StockAccessRevoke(ctx, connect.NewRequest(&inventoryv1.StockAccessRevokeRequest{
		TeamId: warehouse, SellingTeamId: sellingA,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("re-revoke = %v, want NotFound", code)
	}

	// The pair can be granted again — a soft delete must not permanently consume the identity it held.
	_, err = svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: warehouse, SellingTeamId: sellingA,
	}))
	if err != nil {
		t.Fatalf("re-granting a revoked pair must work: %v", err)
	}
}

// #147 — one warehouse's arrangements are invisible and untouchable to another. This is the whole
// point: a grant is permission to take THIS warehouse's stock, so leaking or mutating it across
// warehouses would be handing out someone else's goods.
func TestStockAccess_ScopedToItsWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const mine, theirs, selling uint64 = 5, 6, 2

	_, err := svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: mine, SellingTeamId: selling,
	}))
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	// Another warehouse cannot SEE it.
	resp, err := svc.StockAccessList(ctx, connect.NewRequest(&inventoryv1.StockAccessListRequest{
		TeamId: theirs, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list as another warehouse: %v", err)
	}
	if len(resp.Msg.GetGrants()) != 0 {
		t.Fatalf("another warehouse sees our arrangements: %+v", resp.Msg.GetGrants())
	}

	// …nor REVOKE it by guessing the selling team id.
	_, err = svc.StockAccessRevoke(ctx, connect.NewRequest(&inventoryv1.StockAccessRevokeRequest{
		TeamId: theirs, SellingTeamId: selling,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("cross-warehouse revoke = %v, want NotFound", code)
	}

	// And ours is untouched by the attempt.
	resp, err = svc.StockAccessList(ctx, connect.NewRequest(&inventoryv1.StockAccessListRequest{
		TeamId: mine, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(resp.Msg.GetGrants()) != 1 {
		t.Fatalf("our grant did not survive another warehouse's revoke attempt: %+v", resp.Msg.GetGrants())
	}
}

// #147 — granting twice is AlreadyExists, and a warehouse cannot grant ITSELF.
func TestStockAccess_DuplicateAndSelfGrantRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const warehouse, selling uint64 = 5, 2

	_, err := svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: warehouse, SellingTeamId: selling,
	}))
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	_, err = svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: warehouse, SellingTeamId: selling,
	}))
	if code := connect.CodeOf(err); code != connect.CodeAlreadyExists {
		t.Fatalf("duplicate grant = %v, want AlreadyExists", code)
	}

	// A warehouse already has full access to its own stock through its own roles, so this row would be
	// a no-op that reads like a permission.
	_, err = svc.StockAccessGrant(ctx, connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: warehouse, SellingTeamId: warehouse,
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("self-grant = %v, want InvalidArgument", code)
	}
}

// #147 ships INERT, and that is a property worth pinning: a grant must not change what anyone can
// actually do until #148 teaches the scope check to read it. If this ever fails, the two changes have
// been entangled and the sensitive one is no longer landing alone.
func TestStockAccess_GrantChangesNoBehaviourYet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, selling uint64 = 5, 2

	receive(t, svc, ctx, warehouse, productX, 10)

	_, err := svc.StockAccessGrant(context.Background(), connect.NewRequest(&inventoryv1.StockAccessGrantRequest{
		TeamId: warehouse, SellingTeamId: selling,
	}))
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	// The granted team still sees nothing of this warehouse's stock — the handler scopes by
	// warehouse_id, and a grant does not (yet) widen that.
	resp, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: selling, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(resp.Msg.GetLevels()) != 0 {
		t.Fatalf("a grant leaked stock into the selling team's own view: %+v", resp.Msg.GetLevels())
	}
}
