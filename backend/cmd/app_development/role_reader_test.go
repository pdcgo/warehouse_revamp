package main

import (
	"context"
	"testing"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The adapter behind selling's grant rule (a-grant-goes-only-to-a-team-member, a-suspended-user-is-never-picked): the
// person's role in the team, and the account's suspension, from user_service's resolver — never a selling join.
func TestRoleReader_MemberIsTheRoleAndTheSuspension(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()
	reader := NewRoleReader(access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager()))

	user := user_service_models.User{Username: "grantreader", Email: "grantreader@x.local", Password: "x"}

	err := db.Create(&user).Error
	if err != nil {
		t.Fatalf("user: %v", err)
	}

	err = db.Create(&user_service_models.UserTeamRole{TeamID: 77, UserID: user.ID, Role: int32(role_basev1.Role_ROLE_SELLING_CS)}).Error
	if err != nil {
		t.Fatalf("membership: %v", err)
	}

	member, err := reader.Member(ctx, user.ID, 77)
	if err != nil {
		t.Fatalf("Member: %v", err)
	}

	if member.Role != role_basev1.Role_ROLE_SELLING_CS || member.Suspended {
		t.Fatalf("member of 77 = %+v, want an active Customer Service", member)
	}

	outside, err := reader.Member(ctx, user.ID, 78)
	if err != nil {
		t.Fatalf("Member outside: %v", err)
	}

	if outside.Role != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("in another team = %+v, want no role", outside)
	}

	err = db.Model(&user_service_models.User{}).Where("id = ?", user.ID).Update("is_suspended", true).Error
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}

	suspended, err := reader.Member(ctx, user.ID, 77)
	if err != nil {
		t.Fatalf("Member suspended: %v", err)
	}

	if !suspended.Suspended {
		t.Fatalf("after suspension = %+v, want Suspended", suspended)
	}
}
