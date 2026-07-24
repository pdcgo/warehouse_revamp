package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamByIds is the anti-join primitive. Unknown AND soft-deleted ids are OMITTED from the map —
// callers must check presence, and a deleted team must not leak through here.
func TestTeamByIds_OmitsDeletedAndUnknown(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	alive := newTeam(t, db, "warehouse", "BID-A")
	gone := newTeam(t, db, "warehouse", "BID-B")
	db.Model(&team_service_models.Team{}).Where("id = ?", gone).Update("deleted", true)

	res, err := svc.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
		Ids: []uint64{alive, gone, 9_999_999},
	}))
	if err != nil {
		t.Fatalf("TeamByIds: %v", err)
	}

	data := res.Msg.GetData()

	if _, ok := data[alive]; !ok {
		t.Errorf("the alive team is missing from the map")
	}

	if _, ok := data[gone]; ok {
		t.Errorf("a soft-deleted team leaked through TeamByIds")
	}

	if _, ok := data[9_999_999]; ok {
		t.Errorf("an unknown id appeared in the map")
	}

	// The map is never nil, so ranging an empty result is always safe.
	if data == nil {
		t.Error("data map is nil")
	}
}
