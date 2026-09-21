package team_v1

// Internal test package: it exercises the unexported createTeam core (the pure-DB half of the
// TeamCreate saga), which is exactly what can be unit-tested without a live user_service.

import (
	"context"
	"testing"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func TestCreateTeam_InsertsTeamAndInfo(t *testing.T) {
	db := san_testdb.DB(t)
	s := NewService(db, nil)

	team, err := s.createTeam(context.Background(), &teamv1.TeamCreateRequest{
		Type:     teamv1.TeamType_TEAM_TYPE_SELLING,
		Name:     "Selling Alpha",
		TeamCode: "ALPHA",
	})
	if err != nil {
		t.Fatalf("createTeam: %v", err)
	}

	if team.ID == 0 {
		t.Fatal("team id is 0")
	}

	if team.Type != "selling" {
		t.Errorf("type = %q, want selling", team.Type)
	}

	// The info row is created in the SAME transaction — TeamInfoUpdate relies on it later.
	var infoCount int64
	db.Model(&team_service_models.TeamInfo{}).Where("team_id = ?", team.ID).Count(&infoCount)

	if infoCount != 1 {
		t.Errorf("team_infos rows = %d, want 1 (created with the team)", infoCount)
	}
}

func TestCreateTeam_DuplicateCodeErrors(t *testing.T) {
	db := san_testdb.DB(t)
	s := NewService(db, nil)
	ctx := context.Background()

	req := &teamv1.TeamCreateRequest{Type: teamv1.TeamType_TEAM_TYPE_SELLING, Name: "First", TeamCode: "DUP"}

	_, err := s.createTeam(ctx, req)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = s.createTeam(ctx, &teamv1.TeamCreateRequest{Type: teamv1.TeamType_TEAM_TYPE_SELLING, Name: "Second", TeamCode: "DUP"})
	if err == nil {
		t.Fatal("want an error for a duplicate team_code, got nil")
	}
}

func TestCreateTeam_RootTypeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	s := NewService(db, nil)

	_, err := s.createTeam(context.Background(), &teamv1.TeamCreateRequest{
		Type:     teamv1.TeamType_TEAM_TYPE_ROOT,
		Name:     "Fake Root",
		TeamCode: "ROOT2",
	})
	if err == nil {
		t.Fatal("creating a ROOT team must be rejected")
	}
}
