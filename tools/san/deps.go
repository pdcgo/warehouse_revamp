package main

import (
	"net/http"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// DatabaseDSN is the connection string the operator chose, injected into the graph rather than
// read by it.
//
// A NAMED type, not a bare string: Wire matches providers by type, so a plain `string` would be
// ambiguous the moment the graph needs a second one.
type DatabaseDSN string

// NewDatabase opens the chosen Postgres. GORM reads and writes rows; goose owns the schema, and
// this graph never migrates — `san migrate` drives goose on its own handle, not through GORM.
func NewDatabase(dsn DatabaseDSN) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(string(dsn)), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
}

// NewCache returns Redis when configured, otherwise an in-process cache. See Config.RedisAddr for
// why the choice is not cosmetic in a CLI.
func NewCache(cfg *Config) san_caches.CacheManager {
	if cfg.RedisAddr == "" {
		return san_caches.NewMemoryCacheManager()
	}

	return san_caches.NewRedisCacheManager(redis.NewClient(&redis.Options{Addr: cfg.RedisAddr}))
}

func NewSigner(cfg *Config) *san_auth.Signer {
	return san_auth.NewSigner(cfg.JWTSecret, cfg.TokenTTL)
}

// NewRoleResolver is the role lookup — the same direct read the server uses, so that invalidating
// a user's roles from here evicts the same keys the server would.
func NewRoleResolver(db *gorm.DB, cache san_caches.CacheManager) access_interceptors.RoleResolver {
	return access_interceptors.NewDBRoleResolver(db, cache)
}

// internalHTTPClient is what a service uses to call another service.
type internalHTTPClient struct{ *http.Client }

func NewInternalHTTPClient() *internalHTTPClient {
	return &internalHTTPClient{Client: http.DefaultClient}
}

// NewTeamClient completes user_service's construction. No san command reaches a path that calls
// it, and it points at a server that may not even be running — which is fine, and is the point of
// keeping the tool's commands to handlers that touch one service.
func NewTeamClient(cfg *Config, client *internalHTTPClient) teamv1connect.TeamServiceClient {
	return teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL)
}
