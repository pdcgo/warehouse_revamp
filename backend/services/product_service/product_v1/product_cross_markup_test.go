package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The cross markup survives create → list → update, and the LIST carries it: "what am I charging
// another team for which product" is a question you answer across the catalogue, not one product at
// a time.
func TestProductCrossMarkup_CreateListUpdate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", CategoryId: 1, CrossMarkupBps: 1250,
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}
	if created.Msg.GetProduct().GetCrossMarkupBps() != 1250 {
		t.Fatalf("created markup = %d, want 1250", created.Msg.GetProduct().GetCrossMarkupBps())
	}

	id := created.Msg.GetProduct().GetId()

	list, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}
	if got := listRows(list.Msg.GetItems())[id].GetCrossMarkupBps(); got != 1250 {
		t.Fatalf("listed markup = %d, want 1250", got)
	}

	// Present-and-zero is an instruction: charge this team nothing.
	var zero uint32

	updated, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, CrossMarkupBps: &zero,
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}
	if updated.Msg.GetProduct().GetCrossMarkupBps() != 0 {
		t.Fatalf("markup after update to 0 = %d, want 0", updated.Msg.GetProduct().GetCrossMarkupBps())
	}
}

// An absent markup on update leaves the stored one alone — an edit that only renames a product must
// not quietly reset what other teams are charged.
func TestProductCrossMarkup_AbsentOnUpdateLeavesItAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", CategoryId: 1, CrossMarkupBps: 1500,
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	name := "Widget renamed"

	updated, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: created.Msg.GetProduct().GetId(), Name: &name,
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}
	if updated.Msg.GetProduct().GetCrossMarkupBps() != 1500 {
		t.Fatalf("markup after an unrelated edit = %d, want 1500", updated.Msg.GetProduct().GetCrossMarkupBps())
	}
}

// A product can be born LOCKED. The form offers the switch on create for exactly this reason: a
// product created unlocked and locked a minute later is a minute in which another team can order it.
func TestProductCrossLocked_SetOnCreate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-OURS", Name: "Ours only", CategoryId: 1, CrossLocked: true,
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}
	if !created.Msg.GetProduct().GetCrossLocked() {
		t.Fatalf("created product is not locked")
	}

	// Locked from the first moment: another team never sees it, with no update in between.
	found, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 3, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	for _, id := range found.Msg.GetIds() {
		if id == created.Msg.GetProduct().GetId() {
			t.Fatalf("discover returned a product created LOCKED")
		}
	}
}

// LOCKED takes a product out of cross-team DISCOVERY, without touching the owner's own list. That
// asymmetry is the whole feature: locking is a statement about other teams.
func TestProductCrossLocked_HiddenFromDiscoverOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	open := insertProduct(t, db, 2, "SKU-OPEN", "Anyone may sell this")
	locked := insertProduct(t, db, 2, "SKU-LOCKED", "Ours only")

	yes := true

	_, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: locked, CrossLocked: &yes,
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}

	// Another team browsing for something to sell sees only the unlocked one.
	found, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 3, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	ids := map[uint64]bool{}
	for _, id := range found.Msg.GetIds() {
		ids[id] = true
	}

	if !ids[open] {
		t.Fatalf("discover dropped the unlocked product")
	}
	if ids[locked] {
		t.Fatalf("discover returned a LOCKED product — another team could build an order around it")
	}

	// The owner still sees both: locking is not hiding it from yourself.
	own := listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ACTIVE)
	if len(own) != 2 {
		t.Fatalf("owner's list = %d products, want 2", len(own))
	}
}
