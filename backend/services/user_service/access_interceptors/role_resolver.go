package access_interceptors

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
)

// RoleCacheTTL bounds how stale an access decision may be.
//
// This is a CORRECTNESS bound, not a performance knob: it is the window during which a revoked
// role — or a suspended account — still works. Every write path that changes access invalidates
// explicitly (RoleResolver.Invalidate), so the TTL is a backstop, not the mechanism.
const RoleCacheTTL = time.Minute

// Access is everything the interceptor needs to decide one request.
//
// Resolved in a single call so a request costs one lookup, not three.
type Access struct {
	// Role is the caller's role in the requested team (ROLE_UNSPECIFIED = not a member).
	Role role_basev1.Role `json:"role"`

	// RootRole is their role in the root team. ROOT/ADMIN here is the global super-admin bypass.
	RootRole role_basev1.Role `json:"root_role"`

	// Suspended blocks the request outright, whatever the roles say.
	//
	// This is checked on EVERY request. Checking suspension only at login and at token renewal —
	// as the source did — means a suspended user's existing token keeps working until it
	// expires. A suspension that does not cut off live sessions is not a suspension.
	Suspended bool `json:"suspended"`
}

// RoleResolver answers "may this user act, and as what, in this team?".
//
// Two implementations exist because of the per-service independence rule:
//
//   - a DB resolver, reading user_service's own tables (all services share one Postgres today);
//   - an RPC resolver, for the day a service moves to its own database and can no longer read
//     them.
type RoleResolver interface {
	Resolve(ctx context.Context, userID uint64, teamID uint64) (Access, error)

	// Invalidate drops every cached decision for a user. Call it whenever a membership, a role,
	// or a suspension changes.
	Invalidate(ctx context.Context, userID uint64) error
}

// UserRoleNamespace is the cache-key prefix for all of one user's access decisions.
//
// The TRAILING COLON is load-bearing: without it, evicting user 1 ("role:1") would also evict
// user 11 ("role:11"), because DelNamespace matches a literal prefix.
func UserRoleNamespace(userID uint64) string {
	return fmt.Sprintf("role:%d:", userID)
}

func accessCacheKey(userID uint64, teamID uint64) san_caches.StringKey {
	return san_caches.StringKey(fmt.Sprintf("%s%d", UserRoleNamespace(userID), teamID))
}

// ---------------------------------------------------------------- DB resolver

type dbRoleResolver struct {
	db    *gorm.DB
	cache san_caches.CacheManager
}

// NewDBRoleResolver reads user_service's tables directly.
func NewDBRoleResolver(db *gorm.DB, cache san_caches.CacheManager) RoleResolver {
	return &dbRoleResolver{db: db, cache: cache}
}

func (r *dbRoleResolver) Resolve(ctx context.Context, userID, teamID uint64) (Access, error) {
	key := accessCacheKey(userID, teamID)

	var cached Access

	err := r.cache.Get(ctx, key, &cached)
	if err == nil {
		return cached, nil
	}

	if !errors.Is(err, san_caches.ErrCacheMiss) {
		// A broken cache must not become a broken authorization decision — fall through to the
		// database rather than failing the request.
		_ = err
	}

	suspended, err := r.suspended(ctx, userID)
	if err != nil {
		return Access{}, err
	}

	rootRole, err := r.roleIn(ctx, userID, san_auth.RootTeamID)
	if err != nil {
		return Access{}, err
	}

	role := rootRole

	// Only a second query when the scope is not the root team.
	if teamID != san_auth.RootTeamID && teamID != 0 {
		role, err = r.roleIn(ctx, userID, teamID)
		if err != nil {
			return Access{}, err
		}
	}

	access := Access{Role: role, RootRole: rootRole, Suspended: suspended}

	_ = r.cache.Set(ctx, key, access, RoleCacheTTL)

	return access, nil
}

type roleRow struct {
	Role int32
}

func (r *dbRoleResolver) roleIn(ctx context.Context, userID, teamID uint64) (role_basev1.Role, error) {
	var row roleRow

	// Find, NOT First.
	//
	// This is the single most important line in the service. `First` returns
	// gorm.ErrRecordNotFound when the user is not a member — but EVERY request resolves the ROOT
	// team, and almost nobody is in the root team. Treating "no row" as an error would fail
	// every non-root request in the system.
	//
	// `Find` leaves the struct zeroed and returns no error, so a missing membership reads as
	// role 0 = ROLE_UNSPECIFIED = "not a member", which is exactly right.
	err := r.db.
		WithContext(ctx).
		Table("user_team_roles").
		Select("role").
		Where("user_id = ? AND team_id = ?", userID, teamID).
		Limit(1).
		Find(&row).
		Error
	if err != nil {
		return 0, err
	}

	return role_basev1.Role(row.Role), nil
}

type suspendedRow struct {
	IsSuspended bool
}

// suspended fails CLOSED: a user row that has vanished counts as suspended. A deleted account
// must not keep authorizing requests until its token happens to expire.
func (r *dbRoleResolver) suspended(ctx context.Context, userID uint64) (bool, error) {
	var rows []suspendedRow

	err := r.db.
		WithContext(ctx).
		Table("users").
		Select("is_suspended").
		Where("id = ?", userID).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return true, err
	}

	if len(rows) == 0 {
		return true, nil
	}

	return rows[0].IsSuspended, nil
}

func (r *dbRoleResolver) Invalidate(ctx context.Context, userID uint64) error {
	return r.cache.DelNamespace(ctx, UserRoleNamespace(userID))
}

// ---------------------------------------------------------------- RPC resolver

type rpcRoleResolver struct {
	client userv1connect.UserServiceClient
	cache  san_caches.CacheManager
}

// NewRPCRoleResolver asks user_service over Connect. Use it when a service can no longer read
// user_service's tables directly (i.e. once it has its own database).
func NewRPCRoleResolver(client userv1connect.UserServiceClient, cache san_caches.CacheManager) RoleResolver {
	return &rpcRoleResolver{client: client, cache: cache}
}

func (r *rpcRoleResolver) Resolve(ctx context.Context, userID, teamID uint64) (Access, error) {
	key := accessCacheKey(userID, teamID)

	var cached Access

	err := r.cache.Get(ctx, key, &cached)
	if err == nil {
		return cached, nil
	}

	// The caller's own bearer is forwarded, so user_service resolves the access of the TOKEN
	// HOLDER — never of a user id we hand it. That is what stops RoleResolve from being an
	// authorization oracle.
	req := connect.NewRequest(&userv1.RoleResolveRequest{TeamId: teamID})

	token := san_auth.GetBearer(ctx)
	if token != "" {
		req.Header().Set("Authorization", "Bearer "+token)
	}

	res, err := r.client.RoleResolve(ctx, req)
	if err != nil {
		return Access{}, err
	}

	access := Access{
		Role:      res.Msg.GetRole(),
		RootRole:  res.Msg.GetRootRole(),
		Suspended: res.Msg.GetSuspended(),
	}

	_ = r.cache.Set(ctx, key, access, RoleCacheTTL)

	return access, nil
}

func (r *rpcRoleResolver) Invalidate(ctx context.Context, userID uint64) error {
	return r.cache.DelNamespace(ctx, UserRoleNamespace(userID))
}
