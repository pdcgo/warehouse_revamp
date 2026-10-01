package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func TestTeamDetail_ReturnsTeamAndInfo(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	id := newTeam(t, db, "warehouse", "DET1")

	// TeamInfoUpdate creates the info row (newTeam inserts only the team).
	_, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:        id,
		ContactNumber: proto.String("0812"),
	}))
	if err != nil {
		t.Fatalf("seed info: %v", err)
	}

	res, err := svc.TeamDetail(ctx, connect.NewRequest(&teamv1.TeamDetailRequest{TeamId: id}))
	if err != nil {
		t.Fatalf("TeamDetail: %v", err)
	}

	// Detail is the ONLY read that carries info.
	if res.Msg.GetTeam().GetInfo().GetContactNumber() != "0812" {
		t.Errorf("info.contact = %q, want 0812", res.Msg.GetTeam().GetInfo().GetContactNumber())
	}
}

// A soft-deleted team is NotFound on detail — it must not be readable after deletion.
func TestTeamDetail_DeletedIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	id := newTeam(t, db, "selling", "DET2")
	db.Model(&team_service_models.Team{}).Where("id = ?", id).Update("deleted", true)

	_, err := svc.TeamDetail(ctx, connect.NewRequest(&teamv1.TeamDetailRequest{TeamId: id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound for a deleted team", connect.CodeOf(err))
	}
}
