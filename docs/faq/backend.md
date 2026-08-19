# FAQ — Backend (Go)

Services, RPCs, wiring, tests, audits.

---

## Where do I put a new service?

`backend/services/<name>_service/` — one directory per service, and **the folder name always ends
in `_service`** (`team_service`, not `team`). The Go package matches the folder.

```
backend/services/team_service/
  team_v1/                 handler sub-package, named after the proto iface version (warehouse.team.v1)
    service.go             NewService / NewTeamService + shared helpers
    team_create.go         ONE FILE PER RPC …
    team_create_test.go    … and a unit test beside each
    mapper.go
  team_service_models/     db models — one file per model
  db_migrations/           goose migrations owned by THIS service
  register.go              mounts the handler(s) into the mux
```

Read [../../guidelines/service-guideline.md](../../guidelines/service-guideline.md) before you
start — it is programmer-authoritative and it fixes the shape of List / ByIds / Stat RPCs.

---

## How do I add an RPC?

1. Define the request/response in `proto/warehouse/<domain>/v1/` and `buf generate`
   (see [contract.md](contract.md)).
2. New file in the handler sub-package, named after the RPC — one RPC per file.
3. **A unit test beside it, in the same commit** (`<rpc>_test.go`).
4. **Performance-audit it** once it works — a working RPC is not a finished one.
5. If it writes, **concurrency-audit it too**.
6. If its flow is non-trivial or crosses services, document it in
   `docs/services/<service>/rpc.md` with a mermaid sequence.

---

## How do I wire a new service in?

**Google Wire — never hand-wire.** `wire_gen.go` is generated and must never be hand-edited.

1. Expose `New<X>Service(deps...)` and add it to the `wire.Build` set in
   `backend/cmd/app_development/wire.go`.
2. Give the service a `register.go`:
   `func NewRegister(mux, service, opts) san_grpc.RegisterHandler`.
3. Add one line to the `san_grpc.Register(mux, …)` call in `service_api.go`.
4. Regenerate: `cd backend && go tool wire ./cmd/app_development`.

Mounting and gRPC reflection come from the same call, so a service cannot be served without also
appearing in reflection.

> `go tool wire`, not `go run github.com/google/wire/cmd/wire` — wire is a `tool` directive in
> `go.mod` so it survives `go mod tidy`; the `go run` form does not.

`tools/san` has its **own** composition root: `go tool wire ./tools/san`.

---

## Where do models and migrations go? Can two services share a model?

Per service, always:

```
backend/services/<name>_service/<name>_service_models/<model>.go
backend/services/<name>_service/db_migrations/
```

**No shared model package. No global migration set.** A model belongs to exactly one service, and
you never add a migration for service A from service B. Applied state is tracked per service in its
own `<name>_service_version` table.

If two services need the same data, that is a **contract question — an RPC**, not a shared table.
This is what keeps services independent, and it is the rule most often broken by accident.

---

## Where do I run `go build` / `go test` from?

**The repository root**, not `backend/`.

```sh
go build ./... && go vet ./... && go test ./...
```

The Go module is rooted at the repo, so `backend/` and `tools/` are one module. Run it from
`backend/` and it still works — it just silently skips `tools/`, which is how a broken `tools/san`
lands green.

---

## Do the tests touch my development database?

**No, and they must not.** Everything automated runs against `warehouse_test` — same Postgres
instance (`:5433`), different database — so a test run can never read or corrupt the data the owner
is reviewing on.

- Unit/integration tests use [`backend/pkgs/san_testdb/`](../../backend/pkgs/san_testdb/): a
  per-test transaction that **rolls back**, so tests are isolated and need no cleanup.
- The e2e resets `warehouse_test` fresh each run and drops it after
  (`go run ./cmd/tool db reset-test | drop-test`), and serves on **dedicated ports 8081 / 5175** so
  it can run while your dev servers are up.
- Override the target with `TEST_DATABASE_URL`.

---

## My Go tests all pass suspiciously fast. Are they actually running?

Probably not — `san_testdb` **skips** when no database is reachable. Check Postgres is up
(`docker compose up -d`) and look for `SKIP` in the output.

---

## Do I really have to audit every RPC?

Yes, once it is implemented — but only a **problem** gets written up, so `audits/` stays a list of
problems rather than a log.

| Audit | Applies to | Harness | Written up only when |
| --- | --- | --- | --- |
| performance (`audit-rpc-performance` skill) | every RPC | `backend/pkgs/san_perf/` | HEAVY → `audits/services/<svc>/performances/<Rpc>.md` |
| concurrency (`audit-sql` skill) | every **write** RPC | `backend/pkgs/san_race/` | UNSAFE → `audits/services/<svc>/concurrency/<Rpc>.md` |

A fast, safe RPC produces a one-line answer and no file. **An audit never applies the fix** — the
report is input to a discussion, and an index migration belongs to the owning service and the
owner's decision.

Concurrency matters here because the people using this system work in **pairs on one stock level** —
two callers in the same second is the normal case, not the edge case.

> ⚠ A concurrency test **cannot** use `san_testdb.DB(t)` — that is one transaction, and two
> goroutines inside one transaction never block on each other's locks, never deadlock and never
> lose an update. Use `san_testdb.Pool` through `san_race.New`, build-tagged `raceaudit` so a
> committing test never runs beside the rolling-back ones.

---

## What is `tools/san` versus `backend/cmd/tool`?

Two CLIs, two jobs.

| | Owns | Run from | Example |
| --- | --- | --- | --- |
| `backend/cmd/tool` | the **developer's** side: schema and fixtures | `backend/` | `go run ./cmd/tool migrate up` |
| `tools/san` | the **operator's** side: actions on real data, through the services | repo root | `go run ./tools/san user reset-password --username ani` |

`tools/san` sits at the repo root on purpose — it is a tool of the repository, not part of the
server. Its rules: **a command calls the RPC handler, never a hand-written `UPDATE`** (a second
copy of "hash + stamp `last_password_reset` + evict the cache" is a copy that falls behind); it is
wired with Wire; it validates with `protovalidate.Validate` before calling the handler, because a
directly-called handler gets no validation interceptor; and every change updates
[../tools/san.md](../tools/san.md) in the same commit.

---

## How do I reset a user's password?

Four different paths, because "change my password" and "change anyone's password" are **separate
RPCs with separate policies** — one RPC meaning both, gated as if it only meant the first, is how a
system lets any logged-in user reset any other account.

| You are | Path | RPC | Needs |
| --- | --- | --- | --- |
| the user | Profile → Change Password | `ResetPassword` | the **old** password; no `user_id` exists — the subject is the token holder |
| an admin | Users → the row's overflow menu → Reset Password | `AdminResetPassword` | `ROLE_ROOT` / `ROLE_ADMIN` (unscoped); the item is hidden on your own row |
| locked out | Login → Forgot password → OTP by phone | `ResetPasswordWithOtp` | nothing — see [the flow](../services/user_service/rpc.md#the-forgot-password-flow-requestpasswordresetotp--resetpasswordwithotp) |
| an operator, no UI | `go run ./tools/san user reset-password --username ani` (repo root) | calls `AdminResetPassword` | database access |

Any of them **kills every existing session for that account** — the reset stamps
`last_password_reset`, which invalidates tokens issued before it, and evicts the cached roles.
Minimum length (8) is the proto's rule, applied everywhere including the CLI.

⚠ Running `san` against a deployment, **set `REDIS_ADDR`** — otherwise it evicts a cache only it can
see and the running servers keep serving that user's cached roles for ~1 minute. Full reference:
[../tools/san.md](../tools/san.md#user-reset-password).

---

## Why is my new RPC returning permission denied?

**A message with no policy is DENIED** — deny by default. The ACL lives in the `.proto`; see
[contract.md](contract.md#where-do-i-declare-who-may-call-an-rpc).

Common causes, in order:

1. No `request_policy` on the request **message**. It extends `MessageOptions`, not
   `MethodOptions` — it does not go on the `rpc`.
2. A team-level role (`TEAM_OWNER`, `WAREHOUSE_ADMIN`, …) on a message with **no `use_scope`
   field**. An unscoped roles-policy is evaluated against the root team, so those entries become
   dead letters. Give it a scope, or narrow the policy to `[ROOT, ADMIN]`.
3. The caller did not send `team_id` in the **request body**. Team scope is a message field, never
   a header — no interceptor can supply it.
4. The generated option package is not linked into the binary, so `proto.HasExtension` silently
   returns false and the option looks absent. It reads as a logic bug; it is a linking bug.

Enforcement lives in
[`backend/services/user_service/access_interceptors/`](../../backend/services/user_service/access_interceptors/)
— user_service owns identity and roles, so it owns the enforcement. The generic primitives (JWT,
reading the proto options, descriptor validation) are in
[`backend/pkgs/san_auth/`](../../backend/pkgs/san_auth/).

---

## Does the token carry my role?

**No — identity only.** Roles are read from the database per request (cached about a minute,
invalidated on every membership change), so revoking a role takes effect without reissuing tokens.
ROOT/ADMIN in team 1 (the root team) bypass every scope check.

---

## How is Go written here?

Assign the error, then check it on its own line — do not fold the call into the `if`:

```go
err = execution()
if err != nil {
    return err
}
```

Break long method chains one step per line. One handler method per file as a service grows. Never
use `golang.org/x/net/http2/h2c` — it is deprecated; `net/http` speaks unencrypted HTTP/2 natively
through `http.Protocols`.
