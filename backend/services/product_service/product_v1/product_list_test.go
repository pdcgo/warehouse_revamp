package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// List is team-scoped: it returns only the caller's team's products, never another team's.
func TestProductList_ScopedToTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 2, "A-2", "Beta")
	insertProduct(t, db, 3, "B-1", "Gamma") // another team

	resp, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total items = %d, want 2 (team 3's product must not leak)", resp.Msg.GetPageInfo().GetTotalItems())
	}
	for _, p := range resp.Msg.GetProducts() {
		if p.GetTeamId() != 2 {
			t.Errorf("got a product from team %d in team 2's list", p.GetTeamId())
		}
	}
}

func TestProductList_QueryAndPaging(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "BOLT-1", "Steel bolt")
	insertProduct(t, db, 2, "NUT-1", "Steel nut")
	insertProduct(t, db, 2, "GLUE-1", "Adhesive")

	// q matches name OR sku.
	resp, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Q: "steel",
		Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList(q): %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("q=steel total = %d, want 2", resp.Msg.GetPageInfo().GetTotalItems())
	}

	// limit 2 over 3 rows → 2 pages.
	paged, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("ProductList(paged): %v", err)
	}
	if len(paged.Msg.GetProducts()) != 2 || paged.Msg.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("paging: got %d rows, %d pages; want 2 and 2",
			len(paged.Msg.GetProducts()), paged.Msg.GetPageInfo().GetTotalPage())
	}
}
