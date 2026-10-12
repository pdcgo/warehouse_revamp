# `san_config`

Assembles one configuration struct from layered sources: struct defaults, then a YAML file, then
the environment — each layer overriding only what it actually defines.

- **Runnable usage:** [example_test.go](example_test.go) — compiled by `go test`, so it cannot drift
- **Real callers:** [backend/cmd/app_development/config.go](../../cmd/app_development/config.go),
  [tools/san/config.go](../../../tools/san/config.go)

```go
import "github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
```

---

## The whole idea in one call

```go
type Config struct {
    Addr           string        `env:"ADDR"            yaml:"addr"`
    DatabaseURL    string        `env:"DATABASE_URL"    yaml:"database_url"`
    TokenTTL       time.Duration `env:"TOKEN_TTL"       yaml:"token_ttl"`
    AllowedOrigins []string      `env:"ALLOWED_ORIGINS" yaml:"allowed_origins"`
}

cfg := Config{                                  // layer 0: defaults are just assignment
    Addr:     "localhost:8080",
    TokenTTL: 24 * time.Hour,
}

err := san_config.NewConfiguration(&cfg,
    san_config.NewOptionalYamlSecretProvider("config.yaml"), // layer 1
    san_config.NewEnvSecretProvider(""),                     // layer 2, wins
)
```

**Providers apply in order, and a later one overrides only the fields it defines.** So the natural
arrangement is base first, overrides last. There is no separate "defaults" mechanism because the
struct already is one.

```
zero value ─→ struct defaults ─→ config.yaml ─→ environment ─→ cfg
                                  (optional)     (per field)
```

## Providers

| | |
| --- | --- |
| `NewEnvSecretProvider(prefix)` | fields tagged `env:"NAME"`, read from the process environment. `prefix` is prepended: `"APP_"` + `PORT` → `APP_PORT` |
| `NewYamlSecretProvider(path)` | a YAML file. Missing file is an **error** |
| `NewOptionalYamlSecretProvider(path)` | same, but a missing file is a **no-op**. For the local override file that only exists on a developer's machine |
| `NewGoogleSecretProvider(ctx, project, secret)` | Secret Manager, parsed as YAML — and JSON is valid YAML, so a JSON payload works unchanged |
| `NewGoogleSecretVersionProvider(ctx, name)` | the same, pinned to an exact version. **Prefer this in production** — `latest` means a deploy can silently pick up a secret someone changed an hour ago |

Anything with `Unmarshal(dst any) error` is a provider, so a flags layer or a test stub drops
straight in. The one rule is the contract below.

## ⚠ The contract that makes layering work

> **A provider fills the fields it knows about and leaves every other field untouched.**

That is not a style note — it is the whole mechanism. A provider that zeroed the fields it has no
opinion about would wipe out the layer beneath it, and the symptom would be a default reappearing
in production for no visible reason.

Which is why, in `EnvSecretProvider`:

| the variable is… | what happens |
| --- | --- |
| **not set** | the field is left alone — the layer below stands |
| **set but empty** | the field is set to empty. "Set to nothing" is a deliberate act, and distinct from "not set" |

## What an `env` tag can parse

`string`, `bool`, all sized `int`/`uint`, `float32/64`, and:

| | |
| --- | --- |
| `time.Duration` | `"30s"`, `"24h"` — not a raw nanosecond count |
| slices | comma-separated, elements trimmed: `"a, b,c"` → `["a","b","c"]`. **An empty string is an empty slice**, not a one-element slice containing `""` |
| pointers | allocated on demand |
| any `encoding.TextUnmarshaler` | asked to parse itself |
| nested structs | **descended into** — the inner fields carry their own `env` tags, the struct field needs none |

`time.Time` and anything implementing `TextUnmarshaler` are treated as **leaves**: they parse
themselves rather than being descended into. Any other type is an error naming the variable.

## ⚠ On error, `dst` is partially written

Earlier providers have already run and written to the struct. Treat a non-nil error as
**"cfg is unusable"**, never as "cfg is half-good" — the usual `log.Fatal` at startup is the right
response.

`dst` must be a non-nil pointer to a struct.

## Tests

```sh
go test ./backend/pkgs/san_config/
```

No fixtures and no environment mutation: `config_test.go` writes its YAML into `t.TempDir()`, and
the environment lookup is indirected through an unexported hook so tests never touch the real
process env.
