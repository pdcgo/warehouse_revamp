package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Soft delete: the product drops out of the list, and its SKU becomes reusable.
func TestProductDelete_SoftDeletesAndFreesSku(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Widget")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDelete: %v", err)
	}

	list, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}
	if list.Msg.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("deleted product still listed (total=%d)", list.Msg.GetPageInfo().GetTotalItems())
	}

	// SKU is free again after the soft delete.
	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Reused",
	}))
	if err != nil {
		t.Fatalf("recreate with freed SKU: %v", err)
	}
}

func TestProductDelete_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 3, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete code = %v, want NotFound", connect.CodeOf(err))
	}
}
