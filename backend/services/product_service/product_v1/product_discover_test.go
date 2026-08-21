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

// The PRIORITY partition (owner). Priority is a flag on the TEAM, held in team_service — a service
// this one must not join to (HARD RULE 3). So the caller resolves which teams are priority and hands
// the ids over; these two filters are the two halves the picker's tabs need.
func TestProductDiscover_OwnerTeamIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")  // a priority team
	insertProduct(t, db, 4, "C-1", "Gamma") // an ordinary other team

	// THE PRIORITY TAB: only the named teams' products.
	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamIds:   []uint64{3},
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	rows := listRows(resp.Msg.GetItems())
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 || len(resp.Msg.GetIds()) != 1 {
		t.Fatalf("owner_team_ids=[3] returned %d items, want 1", resp.Msg.GetPageInfo().GetTotalItems())
	}
	if got := rows[resp.Msg.GetIds()[0]].GetTeamId(); got != 3 {
		t.Errorf("returned team %d, want 3", got)
	}
}

// …and its complement. The two tabs are two halves of ONE partition, so the same id list drives both
// — which is what stops a priority product being listed on the Priority tab AND the Other tab, where
// ticking it once would show it ticked twice.
func TestProductDiscover_ExcludeOwnerTeamIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")  // a priority team
	insertProduct(t, db, 4, "C-1", "Gamma") // an ordinary other team

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		ExcludeOwnTeam:      true,
		ExcludeOwnerTeamIds: []uint64{3},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	// Neither the caller's own (excluded by exclude_own_team) nor the priority team's.
	rows := listRows(resp.Msg.GetItems())
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 || len(resp.Msg.GetIds()) != 1 {
		t.Fatalf("exclude_owner_team_ids=[3] returned %d items, want 1", resp.Msg.GetPageInfo().GetTotalItems())
	}
	if got := rows[resp.Msg.GetIds()[0]].GetTeamId(); got != 4 {
		t.Errorf("returned team %d, want 4", got)
	}
}

// ⚠ AN EMPTY LIST IS NO NARROWING, on both fields — the same convention `owner_team_id = 0` follows.
//
// Worth a test of its own because the failure is silent and inverted: a caller whose priority set is
// empty and which sends `owner_team_ids: []` anyway gets the WHOLE catalogue, and a Priority tab
// showing everything reads as "all of this is priority" rather than as a bug. The contract is what it
// is; the caller is required to render nothing itself, and this pins the behaviour it must work
// around rather than pretending the empty list filters.
func TestProductDiscover_EmptyTeamIdListsDoNotNarrow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		OwnerTeamIds:        []uint64{},
		ExcludeOwnerTeamIds: []uint64{},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if got := resp.Msg.GetPageInfo().GetTotalItems(); got != 3 {
		t.Errorf("empty lists returned %d items, want all 3 (no narrowing)", got)
	}
}

// The narrowings INTERSECT rather than override — naming a team on one list and excluding it on the
// other returns nothing, which is the honest answer to a contradictory ask rather than an error.
func TestProductDiscover_TeamIdListsIntersect(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 3, "B-1", "Beta")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		OwnerTeamIds:        []uint64{3},
		ExcludeOwnerTeamIds: []uint64{3},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if got := resp.Msg.GetPageInfo().GetTotalItems(); got != 0 {
		t.Errorf("contradictory lists returned %d items, want 0", got)
	}
}
