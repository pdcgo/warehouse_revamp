package user_v1

import (
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// AuthService implements [userv1connect.AuthServiceHandler] — the public, tokenless surface.
type AuthService struct {
	db     *gorm.DB
	signer *san_auth.Signer

	// resolver is used to INVALIDATE cached roles on login/logout, and to answer CheckAccess's
	// role question.
	resolver access_interceptors.RoleResolver
}

var _ userv1connect.AuthServiceHandler = (*AuthService)(nil)

func NewAuthService(db *gorm.DB, signer *san_auth.Signer, resolver access_interceptors.RoleResolver) *AuthService {
	return &AuthService{db: db, signer: signer, resolver: resolver}
}

// Service implements [userv1connect.UserServiceHandler].
//
// It owns `users` and `user_team_roles`. It does NOT own teams — team names come from
// team_service over RPC, never from a join.
type Service struct {
	db       *gorm.DB
	signer   *san_auth.Signer
	resolver access_interceptors.RoleResolver

	teams *teamResolver
}

var _ userv1connect.UserServiceHandler = (*Service)(nil)

func NewService(
	db *gorm.DB,
	signer *san_auth.Signer,
	resolver access_interceptors.RoleResolver,
	teamClient teamv1connect.TeamServiceClient,
	cache san_caches.CacheManager,
) *Service {
	return &Service{
		db:       db,
		signer:   signer,
		resolver: resolver,
		teams:    newTeamResolver(teamClient, cache),
	}
}

// identityFor builds the token payload for a user.
//
// One place, so Login and a password reset cannot disagree about what an identity contains —
// and so nothing sensitive is ever accidentally added to it. A token is public to whoever holds
// it: it must carry an id and a username, and nothing else.
func identityFor(user *user_service_models.User) *role_basev1.Identity {
	return &role_basev1.Identity{
		IdentityId:   user.ID,
		Username:     user.Username,
		IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_GENERAL_USER,
	}
}
