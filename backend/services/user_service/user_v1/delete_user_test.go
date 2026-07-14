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

func TestDeleteUser_RemovesUserAndCascadesMemberships(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "todelete", "pw12345678")
	grantRole(t, db, 55, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	_, err := svc.DeleteUser(context.Background(), connect.NewRequest(&userv1.DeleteUserRequest{UserId: uid}))
	if err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	var users, memberships int64
	db.Model(&user_service_models.User{}).Where("id = ?", uid).Count(&users)
	db.Model(&user_service_models.UserTeamRole{}).Where("user_id = ?", uid).Count(&memberships)

	if users != 0 {
		t.Error("user row survived delete")
	}

	if memberships != 0 {
		t.Errorf("memberships = %d, want 0 (ON DELETE CASCADE)", memberships)
	}
}

func TestDeleteUser_RootRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.DeleteUser(context.Background(), connect.NewRequest(&userv1.DeleteUserRequest{UserId: 1}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument for deleting root", connect.CodeOf(err))
	}
}

func TestDeleteUser_MissingIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.DeleteUser(context.Background(), connect.NewRequest(&userv1.DeleteUserRequest{UserId: 9_999_999}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
