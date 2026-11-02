package san_auth

import (
	"context"
	"testing"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// IsOverride is one rule read by every service (an-override-is-stamped-in-every-service), so its four cases are pinned
// here once rather than re-proved per service.
func TestIsOverride(t *testing.T) {
	person := func(scope uint64, role role_basev1.Role) context.Context {
		ctx := WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 1})
		ctx = WithScope(ctx, scope)

		return WithCallerRole(ctx, role)
	}

	cases := []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"root outside the team — in by the bypass", person(7, role_basev1.Role_ROLE_UNSPECIFIED), true},
		{"a member of the team", person(7, role_basev1.Role_ROLE_SELLING_OWNER), false},
		{"root who is a member of the team acts as that member", person(7, role_basev1.Role_ROLE_ROOT), false},
		{"an unscoped call reaches into no team", person(0, role_basev1.Role_ROLE_UNSPECIFIED), false},
		{"no person — an event consumer or a worker", WithScope(context.Background(), 7), false},
	}

	for _, c := range cases {
		got := IsOverride(c.ctx)
		if got != c.want {
			t.Errorf("%s: IsOverride = %v, want %v", c.name, got, c.want)
		}
	}
}
