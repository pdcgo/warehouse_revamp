package team_v1

// Internal test package: it exercises the unexported createTeam core (the pure-DB half of the
// TeamCreate saga), which is exactly what can be unit-tested without a live user_service.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
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

// fakeGrants stands in for user_service: it records every grant and answers with err. Any other
// UserServiceClient method hits the nil embedded interface and panics, which is the point — TeamCreate
// calls nothing else.
type fakeGrants struct {
	userv1connect.UserServiceClient

	err error
	got []*userv1.TeamUserUpdateRequest
}

func (f *fakeGrants) TeamUserUpdate(
	_ context.Context,
	req *connect.Request[userv1.TeamUserUpdateRequest],
) (*connect.Response[userv1.TeamUserUpdateResponse], error) {
	f.got = append(f.got, req.Msg)

	if f.err != nil {
		return nil, f.err
	}

	return connect.NewResponse(&userv1.TeamUserUpdateResponse{}), nil
}

func createRequest(code string, owner uint64) *connect.Request[teamv1.TeamCreateRequest] {
	return connect.NewRequest(&teamv1.TeamCreateRequest{
		Type:        teamv1.TeamType_TEAM_TYPE_WAREHOUSE,
		Name:        "Gudang Pusat",
		TeamCode:    code,
		OwnerUserId: owner,
	})
}

// teamsWithCode counts every row holding the code, deleted ones included — the unique index does.
func teamsWithCode(t *testing.T, db *gorm.DB, code string) (all, live int64) {
	t.Helper()

	db.Model(&team_service_models.Team{}).Where("team_code = ?", code).Count(&all)
	db.Model(&team_service_models.Team{}).Where("team_code = ? AND NOT deleted", code).Count(&live)

	return all, live
}

// the-create-team-form-names-the-first-owner: the NAMED person gets the team type's Owner role, and
// that is the only grant — the caller is not made a member.
func TestTeamCreate_GrantsTheNamedOwner(t *testing.T) {
	db := san_testdb.DB(t)
	grants := &fakeGrants{}
	s := NewService(db, grants)

	res, err := s.TeamCreate(context.Background(), createRequest("GDP", 57))
	if err != nil {
		t.Fatalf("TeamCreate: %v", err)
	}

	if len(grants.got) != 1 {
		t.Fatalf("grants = %d, want exactly 1 (the named Owner, never the caller)", len(grants.got))
	}

	add := grants.got[0].GetAdd()
	if add.GetUserId() != 57 || add.GetRole() != role_basev1.Role_ROLE_WAREHOUSE_OWNER {
		t.Errorf("granted user %d role %v, want user 57 as WAREHOUSE_OWNER", add.GetUserId(), add.GetRole())
	}

	if grants.got[0].GetTeamId() != res.Msg.GetTeam().GetId() {
		t.Errorf("granted on team %d, created team %d", grants.got[0].GetTeamId(), res.Msg.GetTeam().GetId())
	}
}

// A REFUSED Owner (unknown, suspended, not grantable) means nothing was written on user_service's side,
// so the team is removed outright and its code is free: Create again with the same code works.
func TestTeamCreate_ARefusedOwnerFreesTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	grants := &fakeGrants{err: connect.NewError(connect.CodeFailedPrecondition,
		errors.New("a suspended user cannot be added to a team"))}
	s := NewService(db, grants)

	_, err := s.TeamCreate(context.Background(), createRequest("GDP", 57))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want the grant's own FailedPrecondition", connect.CodeOf(err))
	}

	if !strings.Contains(err.Error(), "suspended") {
		t.Errorf("the error should say why the Owner was refused, got: %v", err)
	}

	all, _ := teamsWithCode(t, db, "GDP")
	if all != 0 {
		t.Fatalf("rows with the code = %d, want 0 — a refused create must not burn its code", all)
	}

	grants.err = nil

	_, err = s.TeamCreate(context.Background(), createRequest("GDP", 58))
	if err != nil {
		t.Fatalf("retrying with the same code: %v", err)
	}
}

// An UNKNOWN outcome (a timeout, an outage) may have granted the role after all, so the team is only
// soft-deleted: a hard delete could strand a role pointing at a team that no longer exists.
func TestTeamCreate_AnUnknownOutcomeOnlySoftDeletes(t *testing.T) {
	db := san_testdb.DB(t)
	grants := &fakeGrants{err: connect.NewError(connect.CodeUnavailable, errors.New("user_service is down"))}
	s := NewService(db, grants)

	_, err := s.TeamCreate(context.Background(), createRequest("GDP", 57))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want Internal", connect.CodeOf(err))
	}

	all, live := teamsWithCode(t, db, "GDP")
	if all != 1 || live != 0 {
		t.Errorf("rows = %d, live = %d — want the team kept and soft-deleted", all, live)
	}
}
