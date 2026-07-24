package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Discover is CROSS-team (#106): it returns products from every team, regardless of the caller's team
// (team_id only authorizes the request; it does not scope the results).
func TestProductDiscover_CrossTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")  // another team
	insertProduct(t, db, 4, "C-1", "Gamma") // yet another team

	// Caller is team 2, but discover returns all three teams' products.
	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("discover total = %d, want 3 (all teams)", resp.Msg.GetPageInfo().GetTotalItems())
	}

	// q filters across teams too.
	q, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2, Q: "Beta",
		Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(q): %v", err)
	}
	if q.Msg.GetPageInfo().GetTotalItems() != 1 || q.Msg.GetProducts()[0].GetTeamId() != 3 {
		t.Fatalf("q=Beta should find team 3's product; got %d items", q.Msg.GetPageInfo().GetTotalItems())
	}
}
