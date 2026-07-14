package main

import (
	"net/http"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_verification"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// NewDatabase opens the shared Postgres. GORM reads and writes rows; goose owns the schema.
// There is deliberately no AutoMigrate.
func NewDatabase(cfg *Config) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
}

// NewCache returns Redis when configured, otherwise an in-process cache.
func NewCache(cfg *Config) san_caches.CacheManager {
	if cfg.RedisAddr == "" {
		return san_caches.NewMemoryCacheManager()
	}

	return san_caches.NewRedisCacheManager(redis.NewClient(&redis.Options{Addr: cfg.RedisAddr}))
}

func NewSigner(cfg *Config) *san_auth.Signer {
	return san_auth.NewSigner(cfg.JWTSecret, cfg.TokenTTL)
}

// NewOtp is the OTP backend for the forgot-password flow: Twilio when configured, otherwise the
// mock (which accepts a fixed dev code).
func NewOtp(cfg *Config) san_verification.OtpVerification {
	return san_verification.NewFromConfig(&cfg.Twilio)
}

// NewRoleResolver is the role lookup for EVERY service.
//
// It reads `user_team_roles` directly (owner's call: the interceptor resolves roles from the
// database, not over RPC). All services share one Postgres today, so this is a plain query and
// there is no hop on the hot path.
//
// The alternative — access_interceptors.NewRPCRoleResolver — is implemented and available. Reach for it the
// day a service moves to its OWN database, at which point this direct read stops being possible.
func NewRoleResolver(db *gorm.DB, cache san_caches.CacheManager) access_interceptors.RoleResolver {
	return access_interceptors.NewDBRoleResolver(db, cache)
}

// internalHTTPClient is what services use to call each other.
type internalHTTPClient struct{ *http.Client }

func NewInternalHTTPClient() *internalHTTPClient {
	return &internalHTTPClient{Client: http.DefaultClient}
}

// NewUserClient is how team_service GRANTS a team owner at create time.
//
// Reading a role is a local query (above). WRITING another service's table is not: a write must
// go through that service's own RPC, or its invariants (idempotent upsert, cache invalidation)
// are bypassed. That is why this client exists even though the resolver no longer needs one.
func NewUserClient(cfg *Config, client *internalHTTPClient) userv1connect.UserServiceClient {
	return userv1connect.NewUserServiceClient(client, cfg.InternalBaseURL)
}

func NewTeamClient(cfg *Config, client *internalHTTPClient) teamv1connect.TeamServiceClient {
	return teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL)
}
