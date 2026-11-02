package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Archive: the product drops out of the list, and KEEPS its code — the code is unique over every row, so the same part
// cannot be entered again while the archived product holds it (a-used-product-is-archived-never-deleted).
func TestProductArchive_LeavesTheListAndKeepsItsCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "T2-SKU-1", "Widget")

	_, err := svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductArchive: %v", err)
	}

	list, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}
	if list.Msg.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("deleted product still listed (total=%d)", list.Msg.GetPageInfo().GetTotalItems())
	}

	// The code is NOT free: the archived product still holds it.
	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SKU-1", Name: "Reused",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("recreate under an archived product's code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

func TestProductArchive_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 3, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete code = %v, want NotFound", connect.CodeOf(err))
	}
}
