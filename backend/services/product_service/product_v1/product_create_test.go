package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestProductCreate_CreatesInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", Description: "a widget",
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetId() == 0 || got.GetTeamId() != 2 || got.GetSku() != "SKU-1" || got.GetName() != "Widget" {
		t.Fatalf("unexpected product: %+v", got)
	}
}

// SKU is unique per team among active products.
func TestProductCreate_DuplicateSkuRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[productv1.ProductCreateRequest] {
		return connect.NewRequest(&productv1.ProductCreateRequest{TeamId: 2, Sku: "DUP", Name: "First"})
	}

	_, err := svc.ProductCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.ProductCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate SKU code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The same SKU is fine in a DIFFERENT team.
func TestProductCreate_SameSkuDifferentTeamOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SHARED", Name: "A",
	}))
	if err != nil {
		t.Fatalf("team 2 create: %v", err)
	}

	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 3, Sku: "SHARED", Name: "B",
	}))
	if err != nil {
		t.Fatalf("team 3 create with same SKU should succeed: %v", err)
	}
}
