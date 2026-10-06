package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// root-can-be-several, through the tool: add a Root by username, remove them by email, and never the last one.
func TestUserRoot_AddThenRemove(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)
	ctx := context.Background()

	fajar := insertUser(t, db, "fajar", "fajar@x.local", "password123")

	user, changed, err := san.GrantRoot(ctx, userSelector{username: "fajar"})
	if err != nil || !changed || user.ID != fajar.ID {
		t.Fatalf("add: %v changed=%v", err, changed)
	}

	var membership user_service_models.UserTeamRole

	err = db.Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, fajar.ID).First(&membership).Error
	if err != nil || role_basev1.Role(membership.Role) != role_basev1.Role_ROLE_ROOT {
		t.Fatalf("fajar's root-team role: %v %v", membership.Role, err)
	}

	// Recorded as the tool, not as a person.
	var logged user_service_models.TeamMemberLog

	db.Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, fajar.ID).Order("id DESC").First(&logged)

	if logged.ActorAgent != "san" {
		t.Fatalf("history actor %q, want san", logged.ActorAgent)
	}

	_, err = san.RevokeRoot(ctx, userSelector{email: "FAJAR@x.local"})
	if err != nil {
		t.Fatalf("remove: %v", err)
	}

	err = db.Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, fajar.ID).First(&membership).Error
	if err == nil {
		t.Fatalf("fajar is still in the root team")
	}
}

func TestUserRoot_NeverTheLast(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	// Start from exactly one Root — the seeded user 1.
	db.Where("team_id = ? AND role = ? AND user_id <> 1", san_auth.RootTeamID, int32(role_basev1.Role_ROLE_ROOT)).
		Delete(&user_service_models.UserTeamRole{})

	_, err := san.RevokeRoot(context.Background(), userSelector{id: 1})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing the last Root: %v, want refused", err)
	}
}
