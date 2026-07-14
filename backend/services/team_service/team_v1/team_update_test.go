package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestTeamUpdate_Renames(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	id := newTeam(t, db, "selling", "UPD1")

	res, err := svc.TeamUpdate(context.Background(), connect.NewRequest(&teamv1.TeamUpdateRequest{
		TeamId: id,
		Name:   proto.String("Renamed"),
	}))
	if err != nil {
		t.Fatalf("TeamUpdate: %v", err)
	}

	if res.Msg.GetTeam().GetName() != "Renamed" {
		t.Errorf("name = %q, want Renamed", res.Msg.GetTeam().GetName())
	}
}

// Re-submitting identical values must NOT be a spurious NotFound (Postgres reports 0 rows
// affected on a no-op UPDATE; existence is checked explicitly instead).
func TestTeamUpdate_NoOpIsNotNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	id := newTeam(t, db, "selling", "UPD2")

	_, err := svc.TeamUpdate(context.Background(), connect.NewRequest(&teamv1.TeamUpdateRequest{
		TeamId: id,
		Name:   proto.String("Test Team"), // same as the seeded name
	}))
	if err != nil {
		t.Fatalf("a no-op update must succeed, got: %v", err)
	}
}

func TestTeamUpdate_MissingIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	_, err := svc.TeamUpdate(context.Background(), connect.NewRequest(&teamv1.TeamUpdateRequest{
		TeamId: 9_999_999,
		Name:   proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
