package main

import (
	"errors"
	"strings"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
)

// The dev defaults. Each is fine on a laptop and wrong on Cloud Run, so checkDeployed refuses them there.
const (
	devDatabaseURL = "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable"
	devJWTSecret   = "dev-secret-do-not-use-in-production"
)

// Config is shipment_service's own: only what its two services and the access interceptor read.
//
// On Cloud Run every secret arrives as an ENVIRONMENT VARIABLE, mapped from Secret Manager by the deploy itself
// (`san deploy` passes --set-secrets), so the binary reads env and nothing else in production. The optional
// config.yaml is for a laptop.
type Config struct {
	// Addr is where the server listens. On Cloud Run PORT wins (see NewConfig): the platform picks the port, and a
	// server on any other one is never sent a request.
	Addr string `env:"ADDR" yaml:"addr"`
	Port string `env:"PORT" yaml:"port"`

	// AllowedOrigins are the browser origins permitted to call this service.
	AllowedOrigins []string `env:"ALLOWED_ORIGINS" yaml:"allowed_origins"`

	// DatabaseURL is the Postgres DSN — the SAME database user_service writes `user_team_roles` to, because the
	// access interceptor reads roles from it directly (see NewRoleResolver).
	DatabaseURL string `env:"DATABASE_URL" yaml:"database_url"`

	// RedisAddr enables the shared cache. EMPTY = in-process memory cache.
	//
	// ⚠ Memory is WRONG once Cloud Run runs more than one instance: a revoked role stays cached on the other
	// instances until its TTL lapses.
	RedisAddr string `env:"REDIS_ADDR" yaml:"redis_addr"`

	// JWTSecret VERIFIES identity tokens. It must be the secret user_service signs them with, or no token minted
	// there is accepted here.
	JWTSecret string `env:"JWT_SECRET" yaml:"jwt_secret"`

	// TokenTTL is only used to build the signer; this service mints no token.
	TokenTTL time.Duration `env:"TOKEN_TTL" yaml:"token_ttl"`

	// CloudRunService is set by Cloud Run itself (K_SERVICE). Non-empty = deployed, which is when the dev defaults
	// are refused.
	CloudRunService string `env:"K_SERVICE" yaml:"-"`
}

func NewConfig() (*Config, error) {
	cfg := Config{
		Addr:           "localhost:8090",
		AllowedOrigins: []string{"http://localhost:5174"},
		DatabaseURL:    devDatabaseURL,
		RedisAddr:      "",
		JWTSecret:      devJWTSecret,
		TokenTTL:       24 * time.Hour,
	}

	err := san_config.NewConfiguration(&cfg,
		san_config.NewOptionalYamlSecretProvider("config.yaml"),
		san_config.NewEnvSecretProvider(""),
	)
	if err != nil {
		return nil, err
	}

	if cfg.Port != "" {
		cfg.Addr = ":" + cfg.Port
	}

	err = checkDeployed(&cfg)
	if err != nil {
		return nil, err
	}

	return &cfg, nil
}

// checkDeployed refuses to START on Cloud Run with a dev default still in place.
//
// A missing secret would otherwise fail quietly and late: with the dev JWT secret every real token is "invalid" and
// every signed-in call answers Unauthenticated, and with the dev DSN the service dials a localhost that does not
// exist. A revision that will not start is rolled back by Cloud Run before it takes traffic, which is the loud
// failure we want.
func checkDeployed(cfg *Config) error {
	if cfg.CloudRunService == "" {
		return nil
	}

	var missing []string

	if cfg.JWTSecret == "" || cfg.JWTSecret == devJWTSecret {
		missing = append(missing, "JWT_SECRET")
	}

	if cfg.DatabaseURL == "" || cfg.DatabaseURL == devDatabaseURL {
		missing = append(missing, "DATABASE_URL")
	}

	if len(missing) > 0 {
		return errors.New("deployed with a dev default for " + strings.Join(missing, ", ") +
			" — map it from Secret Manager (san deploy does, with --set-secrets)")
	}

	return nil
}
