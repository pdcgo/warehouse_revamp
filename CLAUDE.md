# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

`warehouse_revamp` is a **new warehouse system, built from scratch**. Not a refactor, not a
port, not a migration.

It is at the **design stage** — almost nothing is decided. The running design discussion is
**[plans/plan.md](plans/plan.md)**. Read it before proposing anything, and keep it current as
decisions land.

---

## HARD RULES

### 1. Clean slate — do not borrow from other projects

Other repos exist on this machine (siblings under `d:\pdcgo`). They are **not a design
input**. Do **not** read them, cite them, compare against them, or reuse their models, status
enums, service boundaries, table designs, or screens — **unless the owner explicitly asks for
that reference in the current message**.

Never justify a proposal with "that's how the existing system does it". Argue it from:

1. what physically happens in the warehouse,
2. who the person is and what task they are trying to finish,
3. what the business must know,
4. the intrinsic trade-offs of the option itself.

The point of building new is to escape an accumulated design, not to re-derive it.

### 2. Every service lives in `./backend/services/<service_name>/`, and the name ends in `_service`

One directory per service. **The folder name always carries the `_service` suffix** —
`hello_service`, not `hello`; `user_service`, not `user`. The Go package matches the folder.

Inside a service, handlers live in a **versioned handler sub-package** named after the proto
iface version (`warehouse.team.v1` → `team_v1`). **One file per RPC**, the constructor in
`service.go`, and a **unit test per RPC** beside it (`<rpc>_test.go`).

```
backend/
  cmd/app_development/       the dev server — wires services into the mux
  cmd/tool/                  the development CLI (HARD RULE 3)
  gen/                       generated code (never hand-edited)
  pkgs/                      shared, non-service packages (e.g. san_config, san_testdb)
  services/
    team_service/            ← one dir per service (folder ends in _service)
      team_v1/               handler sub-package (matches warehouse.team.v1)
        service.go           NewService / NewTeamService + shared helpers
        team_create.go       one file per RPC …
        team_create_test.go  … and a unit test beside each (see Testing)
        mapper.go
      team_service_models/   db models — one file per model (HARD RULE 3)
      db_migrations/         goose migrations, owned by this service (HARD RULE 3)
```

**Testing.** Test in priority order: **unit → integration → e2e**. **Write a unit test for each
RPC as it's implemented** (`<rpc>_test.go` beside the handler). Unit tests run against a real
Postgres through [backend/pkgs/san_testdb/](backend/pkgs/san_testdb/) — a per-test transaction
that rolls back, so tests are isolated and need no cleanup (it *skips* when no DB is reachable).
This is an **adaptation** of the reference project's scenario/seed harness, not an import of it.

**Tests use a SEPARATE database — never the dev one.** All automated tests run against
`warehouse_test`, never the development database (`postgres`) the owner reviews on: same Postgres
instance (`:5433`), a different database, so a test run can never read or corrupt review data.
`san_testdb` creates `warehouse_test` on demand and rolls back per test; the e2e resets it fresh
each run and drops it after (`go run ./cmd/tool db reset-test|drop-test`), and runs its own API/UI
on **dedicated ports (8081 / 5175)** so it cannot reuse — or pollute — the dev servers, and can run
while they're up. Override the target with `TEST_DATABASE_URL`.

### 3. Models and migrations are **per service** — services stay independent

A service owns its own data. There is **no shared model package and no global migration set**.

```
backend/services/<service_name>/
  <service_name>_models/<model>.go    ← the service's db models
  db_migrations/                      ← the service's goose migrations
```

- Migrations are **goose** (Go), and they are **separate per service** — this is what keeps
  services independent. Never add a migration for service A from service B.
- Applied state is tracked per service in its own `<service_name>_version` table.
- A model belongs to exactly one service. If two services need the same data, that is a
  contract question (an RPC), not a reason to share a model package.
- **Document every schema change.** A migration that changes the schema updates
  [docs/database-schema.md](docs/database-schema.md) **in the same commit** — one section per
  service, each with a **mermaid** `erDiagram` of the tables and their relations. The migrations
  are authoritative; the doc mirrors them for humans and must not drift.
- **Document complex / cross-service RPC flows.** Any RPC with a non-trivial flow (multi-step,
  saga, compensation) or a dependency on another service goes in
  `docs/services/<service_name>/rpc.md`, with a **mermaid** sequence/flow diagram. Update it in the
  same commit as any refactor, flow change, or code change that touches the flow — the doc must not
  drift. Simple single-table CRUD RPCs do not need an entry.

Migrations are driven by the **development tool** at [backend/cmd/tool/](backend/cmd/tool/)
(`urfave/cli/v3`), run from `./backend`:

```sh
go run ./cmd/tool migrate create add_users --service user_service   # writes a .sql file, no DB
go run ./cmd/tool migrate up                                        # prompts: database, then service
go run ./cmd/tool migrate status --service user_service
```

Run interactively and it asks **two things, in this order**: which **database**
(`Database Local` / `Database Production`), then which **service**. Selecting Production
additionally requires typing `production` to confirm — a `migrate down` on prod must not be one
arrow-key away from a local one.

- `--service <name>` skips the service prompt. Services are **discovered from the filesystem**
  (`backend/services/*`) — there is no hardcoded list to go stale.
- `--dsn` (or `DATABASE_URL`) skips the database prompt — the non-interactive path for CI.
- `create` touches no database, so it never prompts for one.

The local database is [docker-compose.yaml](docker-compose.yaml) — `docker compose up -d`.
Data is bind-mounted to `./development_data/postgres` (gitignored).

Local connection defaults come from env and match the compose file, so a fresh checkout works
with no config: `POSTGRES_HOST` (localhost), **`POSTGRES_PORT` (5433)**, `POSTGRES_USER`
(user), `POSTGRES_PASSWORD` (password), `POSTGRES_DB` (postgres). Production has **no
default** — it reads `PRODUCTION_DATABASE_URL` and fails if unset.

> Postgres is on **5433, not 5432** — another project on this machine already runs a Postgres
> on 5432, and this system must not share its database.

The general service guideline lives in [plans/plan_service.md](plans/plan_service.md) — it is
the owner's doc; treat it as authoritative and keep this section in sync with it.

### 4. Wiring is **Google Wire**. Never hand-wire dependencies.

The composition root is [backend/cmd/app_development/wire.go](backend/cmd/app_development/wire.go);
`wire_gen.go` is **generated — never hand-edit it**. After changing providers:

```sh
cd backend && go tool wire ./cmd/app_development
```

Wire is registered as a `tool` directive in `go.mod`, so `go tool wire` survives `go mod tidy`
(a plain `go run github.com/google/wire/cmd/wire` does not — tidy prunes the tool's own deps).

A service exposes a `New<X>Service(deps...)` constructor; add it to the `wire.Build` set. To
**mount** it, give the service a `register.go` (`func NewRegister(mux, service, opts)
san_grpc.RegisterHandler`) that mounts its handler(s) and returns the proto service names it
exposes, then add one line to `service_api.go`'s `san_grpc.Register(mux, …)` call. Mounting and
gRPC reflection come from the same call ([backend/pkgs/san_grpc/](backend/pkgs/san_grpc/)), so a
service can't be served without also appearing in reflection, or vice-versa.

CLI entrypoints use **`urfave/cli/v3`** (`cmd/app_development`, `cmd/tool`).

### 5. Do not use `h2c` — it is deprecated

`golang.org/x/net/http2/h2c` is deprecated. `net/http` speaks unencrypted HTTP/2 natively
since Go 1.24 — use `http.Protocols`:

```go
protocols := new(http.Protocols)
protocols.SetHTTP1(true)
protocols.SetUnencryptedHTTP2(true)

srv := &http.Server{Addr: addr, Handler: handler, Protocols: protocols}
```

### 6. Design order: jobs → screens → API → data model

**Frontend first.** The experience is designed first; the proto and the schema are derived
*from the screens* — never the reverse. If a screen can't be tied to a person doing a task, it
doesn't get built.

### 7. Brainstorming lives in `./plans/<service_name>/brainstorming.md`

`./plans/` is where design is thought through **before** it is built. One directory per
service, mirroring the `backend/services/<service_name>/` layout:

```
plans/
  plan.md               system-level design (the people, the jobs, the scope)
  plan_service.md       the general service guideline (owner's doc)
  <service_name>/
    brainstorming.md    ← the design discussion for that service
```

A service is designed in its `brainstorming.md` first. Code follows the doc, not the other way
round — and the doc stays current as decisions land (see HARD RULE 6).

### 8. Don't settle open questions unilaterally

This is a collaborative design. When a decision is needed, put it in the relevant
brainstorming doc as an option with its trade-offs and **ask** — do not quietly pick one and
build on it.

---

## Layout

```
proto/       the API contract — ONE place, one buf module, one generate
backend/     Go server (Connect RPC) — services/<service_name>/ (HARD RULE 2)
frontend/    React + TypeScript (Vite), Connect RPC client
plans/       design discussion — <service_name>/brainstorming.md (HARD RULE 4)
```

Generated code is committed (`backend/gen/`, `frontend/src/gen/`) but **never hand-edited** —
regenerate instead.

## The proto contract

One buf module at [proto/](proto/) serves both sides. A single `buf generate` emits the Go
server stubs and the TypeScript client together, so a contract change is one edit and one
command — no publish step in the middle of the design loop.

- Domain separation comes from **directories** (`proto/warehouse/<domain>/v1/`); evolution
  comes from **proto package versions** (`v1` → `v2`) — not from splitting the module.
- The proto package must match the directory (`warehouse.hello.v1` ⇢
  `proto/warehouse/hello/v1/`) — buf's `STANDARD` lint enforces it.
- After **any** `.proto` edit, run `buf generate` from `proto/` before building either side.

`HelloService` is scaffolding — it exists only to prove the pipeline works end to end. Delete
it once a real domain service replaces it.

## Commands

| Task | Command |
| --- | --- |
| Start local Postgres (`:5433`) | `docker compose up -d` |
| Lint the contract | `cd proto && buf lint` |
| Regenerate Go + TS | `cd proto && buf generate` |
| Run the API (`:8080`) | `cd backend && go run ./cmd/app_development` |
| Build / vet / test Go | `cd backend && go build ./... && go vet ./... && go test ./...` |
| Migrations | `cd backend && go run ./cmd/tool migrate <cmd> --service <svc>` |
| Run the UI (`:5174`) | `cd frontend && npm run dev` |
| Typecheck the UI | `cd frontend && npm run typecheck` |
| Build the UI | `cd frontend && npm run build` |
| E2E (starts both servers) | `cd frontend && npm run e2e` |

Both must run for the UI to reach the API. The server allows CORS from
`http://localhost:5174`; the client base URL is overridable via `VITE_API_URL`.

> The UI dev server is on **5174, not 5173** — another project on this machine dev-serves on
> 5173, and `strictPort` makes a collision fail loudly instead of silently drifting.

Smoke-test the API without the UI:

```sh
curl -X POST http://localhost:8080/warehouse.hello.v1.HelloService/SayHello \
  -H "Content-Type: application/json" -d '{"name":"world"}'
```

## Authorization — the "roling" system

**The ACL of the entire system lives in the `.proto` files.** A request *message* declares who
may call its RPC; one of its fields declares which team the call is scoped to. The access
interceptor reads both by reflection at request time. There is no policy table.

```proto
message TeamInfoUpdateRequest {
  option (warehouse.role_base.v1.request_policy) = {
    roles: [ROLE_ROOT, ROLE_ADMIN, ROLE_TEAM_OWNER]
  };
  uint64 team_id = 1 [(warehouse.role_base.v1.use_scope) = true];
}
```

- **`request_policy` extends `MessageOptions`, not `MethodOptions`** — it goes on the REQUEST
  MESSAGE, not the `rpc`.
- **A message with no policy is DENIED.** Deny by default.
- The token carries **identity only, never a role**. Roles are read from the database per
  request (cached ~1 min, invalidated on every membership change), so revoking a role takes
  effect without reissuing tokens.
- **ROOT/ADMIN in team 1** (the root team) bypass every scope check.

**Where it lives:** [backend/services/user_service/access_interceptors/](backend/services/user_service/access_interceptors/)
— user_service owns identity and roles, so it owns the enforcement. Other services import it.
The generic primitives (JWT, reading the proto options, descriptor validation) are in
[backend/pkgs/san_auth/](backend/pkgs/san_auth/).

### Rules that are easy to get wrong

- **Never put a team-level role (`TEAM_OWNER`, `WAREHOUSE_ADMIN`, …) on a message with no
  `use_scope` field.** An unscoped roles-policy is evaluated against the root team, so those
  entries become **dead letters** — the proto claims something the system does not do. Either
  give it a scope, or narrow the policy to `[ROOT, ADMIN]`.
- **Team scope is a message FIELD, never a header.** The frontend puts `team_id` in each request
  body; no interceptor can supply it.
- **Every guarded handler must get the interceptor.** It is built once in `service_api.go` and
  applied to all of them — mounting it per-handler is how policies end up as decoration.
- **`ValidateDescriptors()` runs at startup** and refuses to boot on a `use_scope` tag that is
  non-uint, nested, or duplicated. Each of those is silent at runtime otherwise.
- Streaming RPCs are **refused**, not degraded: a streaming interceptor cannot read the request
  body, so it cannot read the scope. Authorize per-message inside the handler if one is ever
  needed.
- The role lookup uses **`.Find()`, never `.First()`** — `First` returns `ErrRecordNotFound` for
  a non-member, and every request resolves the root team, where almost nobody is a member.

## Proto options carry policy — two of them so far

A recurring pattern in this system: **behaviour is declared on the proto message and read by
reflection at runtime**, so the contract is readable from the `.proto` alone.

| Option | Extends | Field | Declares |
| --- | --- | --- | --- |
| `warehouse.event_base.v1.event_config` | `MessageOptions` | 50001 | which Pub/Sub topic an event belongs to |
| `warehouse.role_base.v1.request_policy` *(planned)* | `MessageOptions` | 50002 | who may call an RPC (see `plans/user_service/`) |

**The generated option package must be linked into the binary**, or `proto.HasExtension`
silently returns false and the option appears absent. It reads as a logic bug; it is a linking
bug.

### Events — [backend/pkgs/event_source/](backend/pkgs/event_source/)

An event names its own topic; a publisher never does:

```proto
message OrderCreatedEvent {
  option (warehouse.event_base.v1.event_config).event_topic = "order-created";
}
```

`TopicName(event)` reads it, `NewPubsubEventSender(client)` publishes there, and
`NewMuxPushHandler` receives on an HTTP push subscription (trace context rides in the message
attributes both ways). `EmptySender` validates and drops — use it in tests instead of a broker.

Local broker: `docker compose --profile pubsub up -d` (emulator on `:8085`, honours
`PUBSUB_EMULATOR_HOST`).

> **Push subscriptions must have a dead-letter policy.** Pub/Sub treats any non-2xx as a NACK,
> so a permanently malformed message is redelivered forever. The handler cannot distinguish
> poison from transient, and silently ACKing bad payloads would lose them.

### Caching — [backend/pkgs/san_caches/](backend/pkgs/san_caches/)

One `CacheManager` interface, three implementations, one shared codec (proto → protobuf,
everything else → JSON), so they cannot disagree about what a cached value looks like.

| | Use for | |
| --- | --- | --- |
| `NewRedisCacheManager` | production | shared across processes — an eviction on one instance is seen by all |
| `NewMemoryCacheManager` | local dev, tests | ⚠ **per-process eviction.** Revoke on instance A and instance B serves stale until its TTL lapses. Anything whose freshness is a *correctness* property (authorization) needs Redis in production. |
| `NewSkipCacheManager` | tests, debugging | every Get is a miss |

- A miss returns **`ErrCacheMiss`**, never a bare error — a caller must be able to tell "not
  cached" (normal) from "the cache is broken" (alert-worthy).
- **`DelNamespace` matches a literal prefix.** Delimit it: `"role:1"` would also evict
  `"role:11"`. End the namespace with a separator — `"role:1:"`.
- Redis runs on **`:6380`** (`docker compose up -d redis`). Run the conformance suite against
  it with `REDIS_ADDR=localhost:6380 go test ./pkgs/san_caches/...` — the same suite runs
  against both implementations.

## Stack

- **Contract** — protobuf + [buf](https://buf.build) v2 (single module), Connect RPC.
- **Backend** — Go 1.25, `connectrpc.com/connect`, h2c, plain `net/http` mux.
  Dev CLI: `urfave/cli/v3`. Migrations: `pressly/goose/v3` (Postgres via `pgx`).
- **Frontend** — React 18, TypeScript, Vite, **Chakra UI v3**, react-router-dom v7,
  `@connectrpc/connect-web`, Playwright for e2e.
  Connect-ES v2 needs no separate service plugin: `protoc-gen-es` emits the service
  descriptor, and the client is `createClient(HelloService, transport)`.

### The design system

**Build UI from Chakra UI v3 components — reach for a raw native element only on explicit
request.** A control, a layout, a piece of chrome should be a Chakra component (`Button`, `Field`,
`Select`/`NativeSelect`, `Table`, `Dialog`, `Stack`, …), never a hand-rolled `<button>`, `<input>`,
`<select>`, or a bare `<div>` styled by hand — Chakra components carry the theme's sizing, spacing,
colours, and a11y wiring, and skipping them is how an app drifts off its design system. For a rich
picker (searchable, multi-level) prefer Chakra's composable `Select` over `NativeSelect`. If a
native element is genuinely needed, get an explicit ask first.

Two more UI rules:

- **Many row actions → an overflow `Menu`.** When a table row has several actions (roughly three
  or more), collapse them behind a single overflow trigger (a kebab `IconButton`, `MoreHorizontal`)
  opening a Chakra [`Menu`](https://chakra-ui.com/docs/components/menu) — not a row of buttons. **Every
  menu item carries a leading icon** (lucide via `<Icon>`). One or two actions may stay inline.
- **Destructive actions always confirm.** Delete, suspend, remove, reset — anything not trivially
  reversible — goes through a [`ConfirmDialog`](frontend/src/components/ConfirmDialog.tsx) (Chakra
  `Dialog`) before it runs. Never a bare one-click destructive button.

[frontend/src/theme.ts](frontend/src/theme.ts) is the **only** place density and spacing are
set. Two things are centralised there on purpose:

- **Control sizing** defaults to `sm` for button/input/textarea/select. Do **not** sprinkle
  `size="sm"` through the app — an explicit size on a control is an override, and should be
  rare (e.g. `size="xs"` on a table row action).
- **Semantic spacing tokens** — `field` / `card` / `section` / `page`. Components reference
  those, never raw spacing values, so the whole app's density is retuned in one place.

**Icons come from [lucide-react](https://lucide.dev), rendered through Chakra's `<Icon>` wrapper.**
Import the named icon, then wrap it: `import { Pencil } from "lucide-react"` →
`<Icon as={Pencil} boxSize="4" />`. lucide is the only icon source; `<Icon>` is what makes the
icon obey Chakra's sizing/colour tokens, so **size is a `boxSize` token, not a raw pixel prop**
(`"4"` = 16px, the size for an `xs` row action). Do **not** import lucide icons bare
(`<Pencil size={16} />`), and do **not** use emoji or ad-hoc unicode glyphs (`✎`, `🔑`, `⏸`) as
icons — they render differently on every platform. Keep the button's `aria-label` — the icon is
decorative, the label is the name. Chakra's own `CloseButton` is a primitive, not an icon, and
stays.

The accent ramp there is a **placeholder** — no visual identity has been chosen yet.

Auth is deliberately **not wired** into the frontend shell: it's still being designed in
`plans/user_service/brainstorming.md`.

## Go style

Assign the error, then check it on its own line — don't fold the call into the `if`:

```go
err = execution()
if err != nil {
    return err
}
```

Break long method chains across lines, one step per line. One handler method per file as
services grow.

---

## Git workflow

All work happens on a single long-lived **`dev`** branch. Commit straight to `dev` — do **not**
create a branch or a PR per issue/task. The owner keeps `dev` checked out to preview the running
app and review as work lands, so per-issue branch-switching just gets in the way.

- Keep `dev` green: `buf lint`, `go build/vet/test`, frontend typecheck, and the Playwright e2e
  should pass at each commit.
- Track progress on the GitHub Project board (project #2 "Warehouse Revamp", owner `pdcgo`):
  move items **Ready → In progress** when you start, and **In progress → In review** when the
  work is finished and green on `dev`. **Stop at In review** — do **not** move to Done and do
  **not** `gh issue close` it yourself. The owner previews on `dev`, then flips it to Done and
  closes the issue. Done means "the owner reviewed it", not "the code landed".
- Promote to `main` by merging `dev` → `main` **when the owner asks**. Never force-push `main`;
  never push `main` or merge without an explicit ask.

CI (`.github/workflows/ci.yml`) runs on push-to-`main` and every PR: buf lint + generated-drift
check, `go build/vet/test`, frontend build, and Playwright e2e against Postgres + Redis service
containers.

## graphify

This project uses [graphify](https://pypi.org/project/graphifyy/) to turn the codebase into a
queryable knowledge graph.

**Status: the graph does not exist yet.** graphify is plumbed in and dormant; it starts
earning its keep once real modules land.

### Invoking it

graphify is not on PATH. It lives in this repo's venv:

```sh
.venv/Scripts/graphify.exe --help        # direct (Windows)
source .venv/Scripts/activate            # or activate, then bare `graphify`
```

### Once code exists

```sh
graphify .                # first build (semantic pass; costs API tokens)
graphify update .         # after changing code — AST-only, no API cost
```

### Rules (apply once `graphify-out/graph.json` exists)

- For codebase questions, run `graphify query "<question>"` **before** grep/rg or reading
  source files. It returns a scoped subgraph — usually far smaller than raw grep output.
- `graphify explain "<concept>"` for a focused concept; `graphify path "<A>" "<B>"` for how
  two things relate; `graphify affected "<X>"` for blast radius before a change.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when
  query/explain/path don't surface enough.
- Read raw files once graphify has oriented you, or to modify/debug specific lines.
- This applies to subagents too — carry the rule into their prompts.

A `PreToolUse` hook ([.claude/hooks/graphify-guard.js](.claude/hooks/graphify-guard.js))
enforces this. It is self-guarding: it stays silent until `graphify-out/graph.json` exists, so
it makes no noise while the repo is empty.

> It is written in **Node, not python3** — `python3` does not exist on this machine.

`graphify-out/` and `.venv/` are gitignored — both are large and rebuildable.
