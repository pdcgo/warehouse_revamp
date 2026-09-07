# FAQ — Database and migrations

Postgres on `:5433`, [goose](https://github.com/pressly/goose) migrations, **owned per service**.

---

## How do I create a migration?

From `backend/`, with the owning service named:

```sh
go run ./tools/san migrate create add_users --service user_service
```

That writes a `.sql` file into `backend/services/user_service/db_migrations/` and touches **no
database**, so it never prompts for one.

⚠ Never add a migration for service A from service B. A service owns its own schema — that is what
keeps services independent.

---

## How do I apply migrations?

```sh
cd backend
go run ./tools/san migrate up                          # prompts: database, then service
go run ./tools/san migrate up --service user_service   # skips the service prompt
go run ./tools/san migrate status --service user_service
```

Run interactively and it asks **two things, in this order**: which **database** (Local /
Production), then which **service**.

Services are discovered from the filesystem (`backend/services/*`) — there is no hardcoded list to
go stale, so a new service shows up in the prompt the moment its folder exists.

---

## It is prompting me for Local or Production. Which do I pick?

**Database Local** for everything you do day to day. Selecting Production additionally requires
typing `production` to confirm — a `migrate down` on prod must not be one arrow-key away from a
local one.

Local defaults come from env and match the compose file, so a fresh checkout works with no config:

| Var | Default |
| --- | --- |
| `POSTGRES_HOST` | `localhost` |
| `POSTGRES_PORT` | **`5433`** |
| `POSTGRES_USER` | `user` |
| `POSTGRES_PASSWORD` | `password` |
| `POSTGRES_DB` | `postgres` |

**Production has no default** — it reads `PRODUCTION_DATABASE_URL` and fails if unset.

`--dsn` (or `DATABASE_URL`) skips the database prompt — that is the non-interactive path for CI.

---

## Why is Postgres on 5433?

Another project on this machine already runs a Postgres on 5432, and this system must not share its
database. Same reason Redis is on 6380.

---

## Do I have to update `docs/database-schema.md`?

**Yes — in the same commit as the migration.** One section per service, each with a mermaid
`erDiagram` of its tables and their relations.

The migrations are authoritative; the doc mirrors them for humans and must not drift.

And the diagram **must parse**:

```sh
cd frontend && npm run lint:mermaid
```

See [troubleshooting.md](troubleshooting.md#my-mermaid-diagram-renders-as-an-error-box).

---

## How do I reset my local database?

The data is a bind mount, so a reset is a container-down plus a directory removal:

```sh
docker compose down
rm -rf development_data/postgres          # gitignored
docker compose up -d
go run ./tools/san migrate up   # once per service
go run ./tools/san seed dev
go run ./tools/san seed categories
```

For the **test** database, there is a command — never touch the dev one with it:

```sh
go run ./tools/san db reset-test    # drops + recreates warehouse_test
go run ./tools/san db drop-test
```

---

## How do I seed categories?

One command, run from `backend/`:

```sh
go run ./tools/san seed categories             # seed_asset/category.json
go run ./tools/san seed categories -f other.json
```

It upserts the global product-category tree (25 top-level, 127 nodes) from
[`backend/seed_asset/category.json`](../../backend/seed_asset/category.json), whose shape is
`{ "categories": [ { "name": …, "children": [ … ] } ] }` — nesting is arbitrary and becomes
`parent_id` ([schema](../database-schema.md)).

| | |
| --- | --- |
| **Idempotent** | matched on `(parent, name)` among non-deleted rows, so a re-run inserts nothing and never touches an existing row |
| **Not refused on Production** | unlike `seed dev`, this is **real reference data**, not a fake fixture — the database prompt and the "type `production`" confirmation are the guard |
| **Separate from `seed dev`** | `seed dev` only makes up teams and logins; the taxonomy is a different kind of thing and is seeded on its own |

---

## Where is my data actually stored?

`./development_data/postgres`, bind-mounted from the container and gitignored. Deleting that
directory is the reset.

---

## Which database do automated tests use?

`warehouse_test` — never `postgres`, the one the owner reviews on. Details in
[backend.md](backend.md#do-the-tests-touch-my-development-database).

---

## What about Redis?

`docker compose up -d redis`, on **`:6380`**. It backs
[`backend/pkgs/san_caches/`](../../backend/pkgs/san_caches/) — one `CacheManager` interface, three
implementations, one shared codec.

| Implementation | Use for | |
| --- | --- | --- |
| `NewRedisCacheManager` | production | shared across processes — an eviction on one instance is seen by all |
| `NewMemoryCacheManager` | local dev, tests | ⚠ **per-process eviction.** Anything whose freshness is a *correctness* property (authorization) needs Redis in production |
| `NewSkipCacheManager` | tests, debugging | every Get is a miss |

Two things that bite:

- A miss returns **`ErrCacheMiss`**, never a bare error — a caller must be able to tell "not
  cached" (normal) from "the cache is broken" (alert-worthy).
- **`DelNamespace` matches a literal prefix.** Delimit it — `"role:1"` would also evict
  `"role:11"`. End the namespace with a separator: `"role:1:"`.

Run the conformance suite against real Redis with
`REDIS_ADDR=localhost:6380 go test ./pkgs/san_caches/...` — the same suite runs against both
implementations.

## What timezone is a `DATE` column in?

**Jakarta — WIB, UTC+7.** One calendar for the whole system: every `DATE`, every day boundary, every
report window and every "today" means the Jakarta day
([the-system-runs-on-jakarta-time](../technical/architecture/context_decision.md#the-system-runs-on-jakarta-time)).

Instants are unaffected — they stay `TIMESTAMPTZ` and absolute. The decision is about how an instant
becomes a **day**, not how it is stored.

**The conversion happens once, at the database session** — `TimeZone=Asia/Jakarta` in the DSN. Then
`CURRENT_DATE`, `now()::date` and every `timestamptz → date` cast are already Jakarta, and no handler
converts anything. In Go, never use `time.Local`: it is whatever the host is set to, and a container is
UTC.

⚠ WIB has **no daylight saving**, so a Jakarta day is always exactly 24 hours and `day + 1` is never
ambiguous. Most single-timezone standards carry a DST caveat; this one does not.

⚠ **Not applied yet — deferred by the owner.** The DSN sets no timezone today, so a fresh checkout is on
**UTC**. The ordered change list is
[development_state/architecture](../development_state/architecture/context.md), including the one thing
to decide first: a session-timezone change does **not** rewrite existing `DATE` values.
