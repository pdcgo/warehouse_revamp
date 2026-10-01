package main

import (
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
)

// Config is the operations tool's configuration.
//
// It is deliberately SMALLER than the server's: san serves no traffic, so it has no address, no
// CORS origins and no document storage. What is left is what the service constructors it drives
// require — and one setting that genuinely matters here, RedisAddr.
type Config struct {
	// DatabaseURL is NOT here on purpose. Which database to act on is a per-invocation decision
	// (--dsn, or the Local/Production prompt), so it enters the graph as an argument — see
	// DatabaseDSN in deps.go. Reading it from config as well would give an operator two answers
	// to the same question.

	// RedisAddr is the SHARED cache the running servers use. Empty = an in-process cache.
	//
	// ⚠ It matters more here than it looks. A password reset invalidates the user's cached
	// roles — and with no Redis, san invalidates a cache that only san can see, while the
	// running server keeps serving that user's cached roles until the ~1 minute TTL lapses. The
	// reset itself still takes effect immediately (last_password_reset kills every existing
	// token), so this is a lag in authorization, not in the password. Point it at the server's
	// Redis when acting on a deployment.
	RedisAddr string `env:"REDIS_ADDR" yaml:"redis_addr"`

	// JWTSecret and TokenTTL build the signer. No san command mints a token today —
	// AdminResetPassword deliberately returns none, because the operator is not the subject —
	// but user_v1.NewService takes a signer, and a service is constructed whole or not at all.
	JWTSecret string        `env:"JWT_SECRET" yaml:"jwt_secret"`
	TokenTTL  time.Duration `env:"TOKEN_TTL" yaml:"token_ttl"`

	// InternalBaseURL is where the cross-service Connect clients point. user_service calls
	// team_service to name a team; no san command reaches that path, but the client is part of
	// the service's construction.
	InternalBaseURL string `env:"INTERNAL_BASE_URL" yaml:"internal_base_url"`
}

func NewConfig() (*Config, error) {
	cfg := Config{
		RedisAddr:       "",
		JWTSecret:       "dev-secret-do-not-use-in-production",
		TokenTTL:        24 * time.Hour,
		InternalBaseURL: "http://localhost:8080",
	}

	err := san_config.NewConfiguration(&cfg,
		san_config.NewOptionalYamlSecretProvider("config.yaml"),
		san_config.NewEnvSecretProvider(""),
	)
	if err != nil {
		return nil, err
	}

	return &cfg, nil
}
