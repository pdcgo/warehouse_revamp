package main

import (
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_verification"
)

type Config struct {
	Addr string `env:"ADDR" yaml:"addr"`

	// AllowedOrigins are the browser origins permitted to call the API.
	AllowedOrigins []string `env:"ALLOWED_ORIGINS" yaml:"allowed_origins"`

	// DatabaseURL is the Postgres DSN. Defaults to the docker-compose database (port 5433).
	DatabaseURL string `env:"DATABASE_URL" yaml:"database_url"`

	// RedisAddr enables the shared cache. EMPTY = in-process memory cache.
	//
	// ⚠ Memory is fine for a single dev binary and WRONG for a multi-instance deployment:
	// eviction is per-process, so a revoked role stays live on other instances until its TTL
	// lapses. Authorization freshness is a correctness property.
	RedisAddr string `env:"REDIS_ADDR" yaml:"redis_addr"`

	// JWTSecret signs identity tokens. There is a dev default; production MUST override it.
	JWTSecret string `env:"JWT_SECRET" yaml:"jwt_secret"`

	// TokenTTL is how long a freshly-minted token lives.
	TokenTTL time.Duration `env:"TOKEN_TTL" yaml:"token_ttl"`

	// Twilio configures OTP delivery for the forgot-password flow. Empty (the dev default) means
	// the OTP mock is used — see backend/pkgs/san_verification.
	Twilio san_verification.TwilioConfiguration `yaml:"twilio"`

	// InternalBaseURL is where services reach EACH OTHER over Connect.
	//
	// They share a binary today, but they still talk over RPC rather than through each other's
	// database handles — that is the per-service independence rule, and honouring it now means
	// splitting them out later changes this URL and nothing else.
	InternalBaseURL string `env:"INTERNAL_BASE_URL" yaml:"internal_base_url"`
}

func NewConfig() (*Config, error) {
	cfg := Config{
		Addr:            "localhost:8080",
		AllowedOrigins:  []string{"http://localhost:5174"},
		DatabaseURL:     "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable",
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
