package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func listCodes(res *connect.Response[teamv1.TeamListResponse]) map[string]bool {
	out := map[string]bool{}

	var rowMap map[uint64]*teamv1.TeamRowItem
	for _, it := range res.Msg.GetItems() {
		t := it.GetTeam()
		if t != nil {
			rowMap = t.GetMapData()
		}
	}

	for _, id := range res.Msg.GetIds() {
		row, ok := rowMap[id]
		if ok {
			out[row.GetTeamCode()] = true
		}
	}

	return out
}

func TestTeamList_ByType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	newTeam(t, db, "warehouse", "LWH")
	newTeam(t, db, "selling", "LSELL")

	res, err := svc.TeamList(ctx, connect.NewRequest(&teamv1.TeamListRequest{
		Filter: &teamv1.TeamListFilter{TeamType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	codes := listCodes(res)
	if !codes["LWH"] || codes["LSELL"] {
		t.Errorf("warehouse filter returned %v; want LWH only", codes)
	}
}

// Soft-deleted teams must not appear in the list.
func TestTeamList_ExcludesDeleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	id := newTeam(t, db, "selling", "LGONE")
	db.Model(&team_service_models.Team{}).Where("id = ?", id).Update("deleted", true)

	res, err := svc.TeamList(ctx, connect.NewRequest(&teamv1.TeamListRequest{
		Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	if listCodes(res)["LGONE"] {
		t.Error("a soft-deleted team appeared in TeamList")
	}
}

func TestTeamList_SearchByCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	newTeam(t, db, "warehouse", "FINDME")
	newTeam(t, db, "warehouse", "OTHER")

	res, err := svc.TeamList(ctx, connect.NewRequest(&teamv1.TeamListRequest{
		Filter: &teamv1.TeamListFilter{Q: "FINDM"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	codes := listCodes(res)
	if !codes["FINDME"] || codes["OTHER"] {
		t.Errorf("search q=FINDM returned %v; want FINDME only", codes)
	}
}

// The PRIORITY-PRODUCT feature is a flag on the TEAM (owner): root grants it, and it makes the
// team's whole catalogue priority. This filter is how the product picker resolves its *Priority
// Product* tab — it asks WHICH TEAMS, then narrows a product query by those ids, so product_service
// never has to join `products` to `teams` (HARD RULE 3).
func TestTeamList_PriorityProductOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	priority := newTeam(t, db, "selling", "LPRIO")
	newTeam(t, db, "selling", "LPLAIN")

	err := db.Model(&team_service_models.Team{}).
		Where("id = ?", priority).
		Update("priority_product", true).
		Error
	if err != nil {
		t.Fatalf("grant priority: %v", err)
	}

	res, err := svc.TeamList(ctx, connect.NewRequest(&teamv1.TeamListRequest{
		Filter: &teamv1.TeamListFilter{PriorityProductOnly: true},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	codes := listCodes(res)
	if !codes["LPRIO"] || codes["LPLAIN"] {
		t.Errorf("priority filter returned %v; want LPRIO only", codes)
	}

	// It has to hold on the COUNT as well as the rows: the caller pages this list to collect every
	// priority team id, and a total that still counted the plain teams would make it page past the end
	// and conclude the set was larger than it is.
	if got := res.Msg.GetPageInfo().GetTotalItems(); got != 1 {
		t.Errorf("total_items = %d, want 1", got)
	}
}

// The flag rides on the ROW slice, so a caller that lists priority teams reads it off the response it
// already has rather than making a second per-team lookup.
func TestTeamList_CarriesPriorityFlagOnTheRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	id := newTeam(t, db, "selling", "LROWFLAG")

	err := db.Model(&team_service_models.Team{}).Where("id = ?", id).Update("priority_product", true).Error
	if err != nil {
		t.Fatalf("grant priority: %v", err)
	}

	res, err := svc.TeamList(ctx, connect.NewRequest(&teamv1.TeamListRequest{
		Filter: &teamv1.TeamListFilter{PriorityProductOnly: true},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	var rowMap map[uint64]*teamv1.TeamRowItem
	for _, it := range res.Msg.GetItems() {
		if team := it.GetTeam(); team != nil {
			rowMap = team.GetMapData()
		}
	}

	row, ok := rowMap[id]
	if !ok {
		t.Fatalf("team %d missing from the row slice", id)
	}

	if !row.GetPriorityProduct() {
		t.Error("priority_product is false on the row; want true")
	}
}
