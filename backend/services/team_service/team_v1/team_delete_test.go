package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func TestTeamDelete_SoftDeletes(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	id := newTeam(t, db, "selling", "DEL1")

	_, err := svc.TeamDelete(context.Background(), connect.NewRequest(&teamv1.TeamDeleteRequest{TeamId: id}))
	if err != nil {
		t.Fatalf("TeamDelete: %v", err)
	}

	var team team_service_models.Team
	db.Where("id = ?", id).First(&team)

	if !team.Deleted {
		t.Error("team.deleted = false after TeamDelete; want soft-deleted")
	}
}

// The root team is the super-admin scope and must be undeletable.
func TestTeamDelete_RootRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	_, err := svc.TeamDelete(context.Background(), connect.NewRequest(&teamv1.TeamDeleteRequest{TeamId: 1}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument — the root team cannot be deleted", connect.CodeOf(err))
	}
}

func TestTeamDelete_MissingIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	_, err := svc.TeamDelete(context.Background(), connect.NewRequest(&teamv1.TeamDeleteRequest{TeamId: 9_999_999}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
