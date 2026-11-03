package main

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// NewDatabase opens the Postgres shipment_service shares with user_service. GORM reads and writes rows; goose
// owns the schema (`san migrate`), and a deploy never migrates.
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

// NewSigner verifies the tokens user_service signs — hence the shared JWT_SECRET.
func NewSigner(cfg *Config) *san_auth.Signer {
	return san_auth.NewSigner(cfg.JWTSecret, cfg.TokenTTL)
}

// NewRoleResolver reads `user_team_roles` directly, as the dev server does: one Postgres for every service, so
// the role lookup is a plain query. The day shipment_service gets its OWN database this direct read stops being
// possible, and access_interceptors.NewRPCRoleResolver is the swap.
func NewRoleResolver(db *gorm.DB, cache san_caches.CacheManager) access_interceptors.RoleResolver {
	return access_interceptors.NewDBRoleResolver(db, cache)
}
