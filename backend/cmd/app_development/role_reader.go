package main

import (
	"context"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// roleReader answers selling's RoleReader — whether a user runs a team — with the access
// interceptor's resolver: the same cached lookup every request already pays for, so ShopAccessCheck
// asking about the caller costs a cache hit (a-write-needs-a-grant-or-a-manager).
type roleReader struct {
	resolver access_interceptors.RoleResolver
}

func NewRoleReader(resolver access_interceptors.RoleResolver) selling_v1.RoleReader {
	return &roleReader{resolver: resolver}
}

func (r *roleReader) Roles(ctx context.Context, userID, teamID uint64) (role_basev1.Role, role_basev1.Role, error) {
	access, err := r.resolver.Resolve(ctx, userID, teamID)
	if err != nil {
		return role_basev1.Role_ROLE_UNSPECIFIED, role_basev1.Role_ROLE_UNSPECIFIED, err
	}

	return access.Role, access.RootRole, nil
}
