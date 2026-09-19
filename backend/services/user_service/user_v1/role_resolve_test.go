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
	grantRole(t, db, san_auth.RootTeamID, uid, role_basev1.Role_ROLE_ADMIN)

	ctx := ctxWithIdentity(uid, "resolveme")

	res, err := svc.RoleResolve(ctx, connect.NewRequest(&userv1.RoleResolveRequest{TeamId: 5}))
	if err != nil {
		t.Fatalf("RoleResolve: %v", err)
	}

	if res.Msg.GetRole() != role_basev1.Role_ROLE_WAREHOUSE_ADMIN {
		t.Errorf("role = %v, want WAREHOUSE_ADMIN", res.Msg.GetRole())
	}

	if res.Msg.GetRootRole() != role_basev1.Role_ROLE_ADMIN {
		t.Errorf("root_role = %v, want ADMIN", res.Msg.GetRootRole())
	}

	if res.Msg.GetSuspended() {
		t.Error("suspended = true, want false")
	}
}
