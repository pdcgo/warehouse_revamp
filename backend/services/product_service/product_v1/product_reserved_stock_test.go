package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The hold-back buffer survives create → list → update, and the LIST carries it: "which products am
// I holding stock back on, and how much" is a question you answer across the catalogue, not one
// product at a time.
func TestProductReservedStock_CreateListUpdate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", CategoryId: 1, ReservedStock: 5,
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}
	if created.Msg.GetProduct().GetReservedStock() != 5 {
		t.Fatalf("created reserved = %d, want 5", created.Msg.GetProduct().GetReservedStock())
	}

	id := created.Msg.GetProduct().GetId()

	list, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}
	if got := listRows(list.Msg.GetItems())[id].GetReservedStock(); got != 5 {
		t.Fatalf("listed reserved = %d, want 5", got)
	}

	// Present-and-zero is an instruction: stop holding anything back.
	var zero uint32

	updated, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, ReservedStock: &zero,
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}
	if updated.Msg.GetProduct().GetReservedStock() != 0 {
		t.Fatalf("reserved after update to 0 = %d, want 0", updated.Msg.GetProduct().GetReservedStock())
	}
}

// An absent buffer on update leaves the stored one alone — an edit that only renames a product must
// not quietly start selling the units somebody deliberately held back.
func TestProductReservedStock_AbsentOnUpdateLeavesItAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", CategoryId: 1, ReservedStock: 12,
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
	if updated.Msg.GetProduct().GetReservedStock() != 12 {
		t.Fatalf("reserved after an unrelated edit = %d, want 12", updated.Msg.GetProduct().GetReservedStock())
	}
}

// Absent on create means 0 — a product nobody said anything about holds nothing back, which is how
// the whole catalogue behaved before the column existed.
func TestProductReservedStock_DefaultsToNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", CategoryId: 1,
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}
	if created.Msg.GetProduct().GetReservedStock() != 0 {
		t.Fatalf("reserved with none given = %d, want 0", created.Msg.GetProduct().GetReservedStock())
	}
}
