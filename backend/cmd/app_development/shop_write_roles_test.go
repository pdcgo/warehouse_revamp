package main

import (
	"context"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// runsEveryShop is the role reader of the tests here that place orders about something else — the take, the lines, a
// race: everyone asked about runs the team, so the shop write gate (a-write-needs-a-grant-or-a-manager) passes
// without a seeded grant. The gate itself is tested in selling_v1 (shop_write_gate_test.go).
type runsEveryShop struct{}

func (runsEveryShop) Roles(context.Context, uint64, uint64) (role_basev1.Role, role_basev1.Role, error) {
	return role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_UNSPECIFIED, nil
}

func (runsEveryShop) Member(context.Context, uint64, uint64) (selling_v1.TeamMember, error) {
	return selling_v1.TeamMember{Role: role_basev1.Role_ROLE_SELLING_OWNER}, nil
}
