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
	for _, tm := range res.Msg.GetTeams() {
		out[tm.GetTeamCode()] = true
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
		TeamType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE,
		Page:     &commonv1.PageFilter{Page: 1, Limit: 50},
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
		Page: &commonv1.PageFilter{Page: 1, Limit: 50},
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
		Q:    "FINDM",
		Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamList: %v", err)
	}

	codes := listCodes(res)
	if !codes["FINDME"] || codes["OTHER"] {
		t.Errorf("search q=FINDM returned %v; want FINDME only", codes)
	}
}
