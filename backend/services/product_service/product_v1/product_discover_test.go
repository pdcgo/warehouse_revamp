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
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("discover total = %d, want 3 (all teams)", resp.Msg.GetPageInfo().GetTotalItems())
	}

	// q filters across teams too.
	q, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Filter: &productv1.ProductListFilter{Q: "Beta"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(q): %v", err)
	}
	rows := listRows(q.Msg.GetItems())
	if q.Msg.GetPageInfo().GetTotalItems() != 1 || len(q.Msg.GetIds()) != 1 || rows[q.Msg.GetIds()[0]].GetTeamId() != 3 {
		t.Fatalf("q=Beta should find team 3's product; got %d items", q.Msg.GetPageInfo().GetTotalItems())
	}
}

// `exclude_own_team` is what lets a picker offer "my products" and "other teams' products" as two
// tabs without the same row appearing in both.
//
// It also has to hold on the COUNT, not just the rows: the list is paginated, so a filter that
// narrowed the page while `total_items` kept counting the excluded rows would give the pager pages
// that do not exist. That is the half a client-side filter cannot do, and the reason this is here.
func TestProductDiscover_ExcludeOwnTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2 — the count must exclude own-team rows too, not just the page",
			resp.Msg.GetPageInfo().GetTotalItems())
	}

	rows := listRows(resp.Msg.GetItems())
	for _, id := range resp.Msg.GetIds() {
		if rows[id].GetTeamId() == 2 {
			t.Fatalf("product %d belongs to the calling team and should have been excluded", id)
		}
	}

	// Unset, the behaviour is unchanged: everybody's, including mine.
	all, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(all): %v", err)
	}
	if all.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("total without the flag = %d, want 3", all.Msg.GetPageInfo().GetTotalItems())
	}
}

// `owner_team_id` narrows discovery to ONE team's catalogue — the lens for "I know whose product I
// want". Asserted on the count as well as the rows, for the same reason as the exclusion above: the
// pager reads the count, so a filter the count cannot see offers pages that are not there.
func TestProductDiscover_OwnerTeamFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 3, "B-2", "Beta two")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamId:    3,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2 (team 3 only)", resp.Msg.GetPageInfo().GetTotalItems())
	}

	rows := listRows(resp.Msg.GetItems())
	for _, id := range resp.Msg.GetIds() {
		if rows[id].GetTeamId() != 3 {
			t.Fatalf("product %d belongs to team %d, want only team 3", id, rows[id].GetTeamId())
		}
	}

	// Naming your OWN team while excluding it is a contradiction, and the honest answer is "nothing"
	// rather than an error — the two filters simply intersect.
	none, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamId:    2,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(contradiction): %v", err)
	}
	if none.Msg.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("total = %d, want 0", none.Msg.GetPageInfo().GetTotalItems())
	}
}
