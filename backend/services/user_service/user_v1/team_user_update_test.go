package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func TestTeamUserUpdate_AddThenRemove(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "member", "pw12345678")

	// Add.
	_, err := svc.TeamUserUpdate(context.Background(), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Add{
			Add: &userv1.AddTeamUser{UserId: uid, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF},
		},
	}))
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	var count int64
	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ? AND user_id = ?", 9, uid).Count(&count)
	if count != 1 {
		t.Fatalf("after add, membership rows = %d, want 1", count)
	}

	// Remove.
	_, err = svc.TeamUserUpdate(context.Background(), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Remove{Remove: &userv1.RemoveTeamUser{UserId: uid}},
	}))
	if err != nil {
		t.Fatalf("remove: %v", err)
	}

	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ? AND user_id = ?", 9, uid).Count(&count)
	if count != 0 {
		t.Fatalf("after remove, membership rows = %d, want 0", count)
	}
}

// Adding a user that does not exist is NotFound, not a dangling membership row.
func TestTeamUserUpdate_AddNonexistentUser(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.TeamUserUpdate(context.Background(), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Add{
			Add: &userv1.AddTeamUser{UserId: 9_999_999, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF},
		},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
