package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// RoleResolve answers for the TOKEN HOLDER — never a user id in the request. It returns the
// role in the asked team plus the root-team role (the super-admin bypass) in one call.
func TestRoleResolve_ReturnsRoleAndRootRole(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "resolveme", "pw12345678")
	grantRole(t, db, 5, uid, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	grantRole(t, db, san_auth.RootTeamID, uid, role_basev1.Role_ROLE_ADMINISTRATOR)

	ctx := ctxWithIdentity(uid, "resolveme")

	res, err := svc.RoleResolve(ctx, connect.NewRequest(&userv1.RoleResolveRequest{TeamId: 5}))
	if err != nil {
		t.Fatalf("RoleResolve: %v", err)
	}

	if res.Msg.GetRole() != role_basev1.Role_ROLE_WAREHOUSE_ADMIN {
		t.Errorf("role = %v, want WAREHOUSE_ADMIN", res.Msg.GetRole())
	}

	if res.Msg.GetRootRole() != role_basev1.Role_ROLE_ADMINISTRATOR {
		t.Errorf("root_role = %v, want ADMIN", res.Msg.GetRootRole())
	}

	if res.Msg.GetSuspended() {
		t.Error("suspended = true, want false")
	}
}

// It carries the admin-team role too, so a service on the RPC resolver lets the admin team monitor exactly as the DB
// resolver does (the-admin-team-monitors-read-only) — asked about a team the caller is not in.
func TestRoleResolve_ReturnsTheAdminTeamRole(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "monitorme", "pw12345678")
	grantRole(t, db, 9, uid, role_basev1.Role_ROLE_ADMIN_OWNER)

	res, err := svc.RoleResolve(ctxWithIdentity(uid, "monitorme"), connect.NewRequest(&userv1.RoleResolveRequest{TeamId: 5}))
	if err != nil {
		t.Fatalf("RoleResolve: %v", err)
	}

	if res.Msg.GetAdminTeamRole() != role_basev1.Role_ROLE_ADMIN_OWNER || res.Msg.GetRole() != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Errorf("admin_team_role = %v, role = %v; want ADMIN_OWNER, UNSPECIFIED", res.Msg.GetAdminTeamRole(), res.Msg.GetRole())
	}
}
