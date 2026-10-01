package san_config_test

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
)

// These examples are compiled by `go test`, so they cannot drift from the API.

// The normal arrangement: defaults in the struct, a YAML file over them, the environment on
// top. This is what backend/cmd/app_development and tools/san both do.
func ExampleNewConfiguration() {
	type Config struct {
		Addr           string        `env:"ADDR"            yaml:"addr"`
		DatabaseURL    string        `env:"DATABASE_URL"    yaml:"database_url"`
		TokenTTL       time.Duration `env:"TOKEN_TTL"       yaml:"token_ttl"`
		AllowedOrigins []string      `env:"ALLOWED_ORIGINS" yaml:"allowed_origins"`
	}

	// Layer 0 is the zero value of the struct, so defaults are just… assignment.
	cfg := Config{
		Addr:           "localhost:8080",
		TokenTTL:       24 * time.Hour,
		AllowedOrigins: []string{"http://localhost:5174"},
	}

	err := san_config.NewConfiguration(&cfg,
		san_config.NewOptionalYamlSecretProvider("config.yaml"), // absent on most machines
		san_config.NewEnvSecretProvider(""),                     // wins where it is set
	)
	if err != nil {
		// On error cfg is PARTIALLY written — unusable, not half-good.
		log.Fatal(err)
	}

	fmt.Println(cfg.Addr)
}

// A prefix keeps one process's variables apart from everything else in the environment.
func ExampleNewEnvSecretProvider() {
	type Config struct {
		Port int `env:"PORT"`
	}

	var cfg Config

	// Reads WAREHOUSE_PORT, not PORT.
	err := san_config.NewConfiguration(&cfg, san_config.NewEnvSecretProvider("WAREHOUSE_"))
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(cfg.Port)
}

// Nested structs are descended into, so a sub-struct's fields get their own env names.
func ExampleNewEnvSecretProvider_nested() {
	type Database struct {
		Host string `env:"DB_HOST" yaml:"host"`
		Port int    `env:"DB_PORT" yaml:"port"`
	}

	type Config struct {
		Name     string   `env:"NAME"    yaml:"name"`
		Database Database `yaml:"database"` // no env tag needed on the struct itself
	}

	var cfg Config

	err := san_config.NewConfiguration(&cfg,
		san_config.NewYamlSecretProvider("config.yaml"),
		san_config.NewEnvSecretProvider(""),
	)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(cfg.Database.Host, cfg.Database.Port)
}

// In production the secrets come from Google Secret Manager, layered the same way. Pin the
// version: "latest" means a deploy can silently pick up a change someone made an hour ago.
func ExampleNewGoogleSecretVersionProvider() {
	type Config struct {
		DatabaseURL string `yaml:"database_url"`
		JWTSecret   string `env:"JWT_SECRET" yaml:"jwt_secret"`
	}

	var cfg Config

	err := san_config.NewConfiguration(&cfg,
		san_config.NewGoogleSecretVersionProvider(
			context.Background(),
			"projects/warehouse/secrets/app-config/versions/7",
		),
		san_config.NewEnvSecretProvider(""),
	)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(cfg.DatabaseURL != "")
}

// A provider is anything that fills the fields it knows and leaves the rest alone — that
// "leaves the rest alone" is what makes layering work.
type flagProvider struct {
	addr string
}

func (p flagProvider) Unmarshal(dst any) error {
	cfg, ok := dst.(*struct {
		Addr string
	})
	if !ok {
		return fmt.Errorf("flagProvider: unexpected config type %T", dst)
	}

	if p.addr != "" { // only override when the flag was actually given
		cfg.Addr = p.addr
	}

	return nil
}

func ExampleConfigProvider() {
	cfg := struct {
		Addr string
	}{
		Addr: "localhost:8080",
	}

	err := san_config.NewConfiguration(&cfg, flagProvider{addr: "0.0.0.0:80"})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(cfg.Addr)
	// Output: 0.0.0.0:80
}
