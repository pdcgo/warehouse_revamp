package main

import (
	"strings"
	"testing"
)

// On a laptop the dev defaults are the point: `go run ./backend/cmd/shipment_service` must start with no setup.
func TestTheDevDefaultsStartLocally(t *testing.T) {
	cfg := &Config{JWTSecret: devJWTSecret, DatabaseURL: devDatabaseURL}

	err := checkDeployed(cfg)
	if err != nil {
		t.Fatalf("a local run with the dev defaults must start: %v", err)
	}
}

// On Cloud Run a dev default means a secret was never mapped, and the revision must refuse to start — naming
// every one — rather than answer Unauthenticated to every signed-in call.
func TestADeployWithADevDefaultRefusesToStart(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want []string
	}{
		{
			name: "both missing",
			cfg:  Config{CloudRunService: "s", JWTSecret: devJWTSecret, DatabaseURL: devDatabaseURL},
			want: []string{"JWT_SECRET", "DATABASE_URL"},
		},
		{
			name: "jwt empty",
			cfg:  Config{CloudRunService: "s", JWTSecret: "", DatabaseURL: "host=/cloudsql/x dbname=y"},
			want: []string{"JWT_SECRET"},
		},
		{
			name: "dsn dev",
			cfg:  Config{CloudRunService: "s", JWTSecret: "real", DatabaseURL: devDatabaseURL},
			want: []string{"DATABASE_URL"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := checkDeployed(&tc.cfg)
			if err == nil {
				t.Fatal("a deployed revision with a dev default must refuse to start")
			}

			for _, name := range tc.want {
				if !strings.Contains(err.Error(), name) {
					t.Errorf("error %q does not name %s", err, name)
				}
			}
		})
	}
}

func TestADeployWithItsSecretsStarts(t *testing.T) {
	cfg := &Config{CloudRunService: "s", JWTSecret: "real", DatabaseURL: "host=/cloudsql/x dbname=y"}

	err := checkDeployed(cfg)
	if err != nil {
		t.Fatalf("a deployed revision with real secrets must start: %v", err)
	}
}

// PORT is Cloud Run's choice and must win over ADDR, or the platform sends requests to a port nobody listens on.
func TestPortWinsOverAddr(t *testing.T) {
	t.Setenv("ADDR", "localhost:1234")
	t.Setenv("PORT", "8080")
	t.Setenv("K_SERVICE", "")

	cfg, err := NewConfig()
	if err != nil {
		t.Fatalf("NewConfig: %v", err)
	}

	if cfg.Addr != ":8080" {
		t.Fatalf("Addr = %q, want :8080", cfg.Addr)
	}
}
