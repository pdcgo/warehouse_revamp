package san_config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

type databaseConfig struct {
	Host string `env:"DB_HOST" yaml:"host"`
	Port int    `env:"DB_PORT" yaml:"port"`
}

type testConfig struct {
	Name     string         `env:"NAME"     yaml:"name"`
	Port     int            `env:"PORT"     yaml:"port"`
	Debug    bool           `env:"DEBUG"    yaml:"debug"`
	Timeout  time.Duration  `env:"TIMEOUT"  yaml:"timeout"`
	Origins  []string       `env:"ORIGINS"  yaml:"origins"`
	Database databaseConfig `yaml:"database"`

	unexported string //nolint:unused // guards against panicking on unexported fields
}

// envProvider builds a provider backed by a fake environment, so tests never mutate the
// real process env.
func envProvider(prefix string, env map[string]string) *EnvSecretProvider {
	return &EnvSecretProvider{
		Prefix: prefix,
		lookup: func(key string) (string, bool) {
			value, found := env[key]

			return value, found
		},
	}
}

func writeYaml(t *testing.T, body string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yaml")

	err := os.WriteFile(path, []byte(body), 0o600)
	if err != nil {
		t.Fatalf("writing yaml: %v", err)
	}

	return path
}

// The core contract: env overrides ONLY the keys it defines, and leaves the YAML base alone
// everywhere else.
func TestLayering(t *testing.T) {
	path := writeYaml(t, `
name: from-yaml
port: 8080
debug: false
database:
  host: yaml-host
  port: 5432
`)

	var cfg testConfig

	err := NewConfiguration(&cfg,
		NewYamlSecretProvider(path),
		envProvider("", map[string]string{
			"PORT":    "9090",
			"DB_HOST": "env-host",
		}),
	)
	if err != nil {
		t.Fatalf("NewConfiguration: %v", err)
	}

	// Overridden by env.
	if cfg.Port != 9090 {
		t.Errorf("Port = %d, want 9090 (env should win)", cfg.Port)
	}

	if cfg.Database.Host != "env-host" {
		t.Errorf("Database.Host = %q, want %q (env should win, nested)", cfg.Database.Host, "env-host")
	}

	// NOT defined by env — the yaml layer must survive.
	if cfg.Name != "from-yaml" {
		t.Errorf("Name = %q, want %q (yaml must survive)", cfg.Name, "from-yaml")
	}

	if cfg.Database.Port != 5432 {
		t.Errorf("Database.Port = %d, want 5432 (yaml must survive)", cfg.Database.Port)
	}
}

// An env var that is SET BUT EMPTY is a deliberate act and must be honoured — distinct from
// a var that is not set at all.
func TestEmptyEnvVarOverrides(t *testing.T) {
	path := writeYaml(t, "name: from-yaml\n")

	var cfg testConfig

	err := NewConfiguration(&cfg,
		NewYamlSecretProvider(path),
		envProvider("", map[string]string{"NAME": ""}),
	)
	if err != nil {
		t.Fatalf("NewConfiguration: %v", err)
	}

	if cfg.Name != "" {
		t.Errorf("Name = %q, want empty (an explicitly-empty env var must win)", cfg.Name)
	}
}

func TestEnvTypes(t *testing.T) {
	var cfg testConfig

	err := NewConfiguration(&cfg, envProvider("APP_", map[string]string{
		"APP_NAME":    "warehouse",
		"APP_PORT":    "8080",
		"APP_DEBUG":   "true",
		"APP_TIMEOUT": "30s",
		"APP_ORIGINS": "http://a, http://b",
	}))
	if err != nil {
		t.Fatalf("NewConfiguration: %v", err)
	}

	if cfg.Name != "warehouse" {
		t.Errorf("Name = %q", cfg.Name)
	}

	if cfg.Port != 8080 {
		t.Errorf("Port = %d", cfg.Port)
	}

	if !cfg.Debug {
		t.Error("Debug = false, want true")
	}

	if cfg.Timeout != 30*time.Second {
		t.Errorf("Timeout = %v, want 30s", cfg.Timeout)
	}

	want := []string{"http://a", "http://b"}
	if len(cfg.Origins) != len(want) {
		t.Fatalf("Origins = %v, want %v", cfg.Origins, want)
	}

	for i := range want {
		if cfg.Origins[i] != want[i] {
			t.Errorf("Origins[%d] = %q, want %q (elements must be trimmed)", i, cfg.Origins[i], want[i])
		}
	}
}

func TestEnvBadValue(t *testing.T) {
	var cfg testConfig

	err := NewConfiguration(&cfg, envProvider("", map[string]string{"PORT": "not-a-number"}))
	if err == nil {
		t.Fatal("want an error for an unparseable int, got nil")
	}
}

func TestPrefixIsolation(t *testing.T) {
	var cfg testConfig

	// NAME is set, but only unprefixed — with a prefix configured it must not be seen.
	err := NewConfiguration(&cfg, envProvider("APP_", map[string]string{"NAME": "leaked"}))
	if err != nil {
		t.Fatalf("NewConfiguration: %v", err)
	}

	if cfg.Name != "" {
		t.Errorf("Name = %q, want empty — an unprefixed var must not satisfy a prefixed provider", cfg.Name)
	}
}

func TestOptionalYamlMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.yaml")

	var cfg testConfig

	err := NewConfiguration(&cfg, NewOptionalYamlSecretProvider(missing))
	if err != nil {
		t.Fatalf("optional provider must tolerate a missing file, got: %v", err)
	}

	err = NewConfiguration(&cfg, NewYamlSecretProvider(missing))
	if err == nil {
		t.Fatal("a REQUIRED yaml provider must fail on a missing file")
	}
}

func TestMalformedYamlAlwaysFails(t *testing.T) {
	path := writeYaml(t, "name: [unclosed\n")

	var cfg testConfig

	// Optional means "may be absent", NOT "may be broken".
	err := NewConfiguration(&cfg, NewOptionalYamlSecretProvider(path))
	if err == nil {
		t.Fatal("a malformed yaml file must fail even when the provider is optional")
	}
}

func TestBadTarget(t *testing.T) {
	cases := map[string]any{
		"nil":            nil,
		"non-pointer":    testConfig{},
		"pointer to int": new(int),
		"nil pointer":    (*testConfig)(nil),
	}

	for name, dst := range cases {
		t.Run(name, func(t *testing.T) {
			err := NewConfiguration(dst)
			if err == nil {
				t.Fatalf("want an error for %s dst, got nil", name)
			}
		})
	}
}

func TestNilProvider(t *testing.T) {
	var cfg testConfig

	err := NewConfiguration(&cfg, nil)
	if err == nil {
		t.Fatal("want an error for a nil provider, got nil")
	}
}
