# Warehouse Revamp

A warehouse management system, **built new from first principles** — not a port of anything. It is
in active design: the running discussion lives in [../plans/](../plans/), and screens are designed
before the API and the schema are derived from them.

This document is the map. For the authoritative detail, follow the links.

---

## What it is

A single repository holding three sides of one system, plus the design record:

```
proto/       the API contract — one buf module; one `buf generate` emits both sides
backend/     Go server (Connect RPC over net/http), one directory per service
frontend/    React + TypeScript (Vite) + Chakra UI v3, a Connect-ES client
plans/       the design discussion — one brainstorming doc per service
docs/         human-facing docs (this file, the schema, per-service RPC flows)
```

The contract is the source of truth. A change to a `.proto` regenerates the Go server stubs and the
TypeScript client together, so there is no publish step in the middle of the design loop.

---

## Architecture

**Contract-first.** [proto/](../proto/) is one [buf](https://buf.build) v2 module. Domains are
directories (`proto/warehouse/<domain>/v1/`); evolution is proto package versions (`v1` → `v2`).
`buf generate` emits `backend/gen/` and `frontend/src/gen/` — both committed, never hand-edited.

**One service per directory.** Each backend service lives in
`backend/services/<name>_service/` and **owns its own data** — its db models
(`<name>_service_models/`) and its [goose](https://github.com/pressly/goose) migrations
(`db_migrations/`). There is no shared model package and no global migration set; if two services
need the same data, that is an RPC contract, not a shared table. Handlers sit in a versioned
sub-package (`<name>_v1/`), one file per RPC with a unit test beside it.

**Wiring is [Google Wire](https://github.com/google/wire).** The composition root is
`backend/cmd/app_development/`; a service exposes a `New<X>Service(...)` constructor and a
`register.go` that mounts it. Mounting and gRPC reflection come from the same call, so a service
can't be served without also appearing in reflection.

**Authorization is declared in the proto.** A request *message* declares which roles may call its
RPC and which field carries the team scope; an interceptor reads both by reflection at request
time. Deny by default. The token carries identity only — roles are read from the database per
request — so revoking access takes effect without reissuing tokens. See
[the roling notes](../CLAUDE.md#authorization--the-roling-system).

**Frontend built from the design system.** UI is composed from Chakra UI v3 components; density and
spacing are centralised in `frontend/src/theme.ts`; icons are [lucide](https://lucide.dev) through
Chakra's `<Icon>`. The UI is internationalised with
[react-i18next](https://react.i18next.com) (English + Bahasa Indonesia; catalogs under
`frontend/src/i18n/locales/`).

---

## Services

| Service | Owns |
| --- | --- |
| `user_service` | identity, authentication, roles, and the access interceptor |
| `team_service` | teams (root / admin / warehouse / selling) and memberships |
| `category_service` | the global product taxonomy (a tree) |
| `product_service` | each team's product catalogue |
| `shipping_service` | the courier catalogue |
| `inventory_service` | warehouse stock — receive, adjust, transfer, on-hand levels |
| `selling_service` | marketplace shops and orders (the selling side) |
| `document_service` | uploaded files (two-phase upload, e.g. product images) |

The warehouse **fulfilment** core (the physical operation — who works there, the jobs, whether
anything is barcoded) is deliberately **not designed yet**; it is the foundation the order and
revenue work waits on. See [../plans/plan.md](../plans/plan.md).

---

## Running it locally

Prerequisites: Go, Node, and Docker (for Postgres). All commands assume the repo root.

```sh
docker compose up -d                      # Postgres on :5433 (and Redis on :6380)
cd backend && go run ./cmd/tool migrate up # apply migrations (prompts for db + service)
cd backend && go run ./cmd/app_development # the API on :8080
cd frontend && npm install && npm run dev  # the UI on :5174 (talks to :8080)
```

Both servers must run for the UI to reach the API. More commands (lint, generate, test, e2e,
migrations) are in the [top-level guide](../CLAUDE.md#commands).

### Testing

Test in priority order — unit → integration → e2e. Backend unit tests run against a **separate**
Postgres database (`warehouse_test`, never the dev one) with a per-test transaction that rolls
back. The Playwright e2e runs its own API/UI on dedicated ports so it can run alongside the dev
servers without touching their data.

```sh
cd backend  && go build ./... && go vet ./... && go test ./...
cd frontend && npm run typecheck && npm run build && npm run e2e
```

---

## Overnight delegation mode

The board can be worked **autonomously** — for leaving a batch of ready issues running overnight
while you review progress from the GitHub Project board on your phone. It works the **Ready**
column: each issue is triaged, the genuinely-actionable ones are built on `dev` (one at a time,
kept green) and moved to **In review**; anything under-specified or blocked is left in Ready with
a `🌙 overnight (parked)` comment saying why — never half-built.

**Control keywords** (say these to Claude Code):

| Say | Effect |
| --- | --- |
| `overnight mode: start` | Begin the autonomous run — sweep the Ready column, implement the actionable issues, re-checking through the night for anything you add. |
| `overnight mode: stop` | Halt after the current step. Nothing in flight is left half-committed; `dev` stays green. |
| `overnight mode: status` | Report what's In review, In progress, and parked so far. |

**Guardrails it always honours:**

- Commits to `dev` **only when the full green gate passes** (`buf lint`, `go build/vet/test`,
  frontend `typecheck`). Never commits red.
- Moves each issue **In progress → In review** and **stops there** — never Done, never closes an
  issue, never pushes or merges to `main`. You review and flip those.
- **Non-destructive to your other work** — it only stages or reverts the exact files it creates
  for an issue, never unrelated uncommitted changes in your tree.
- Every provisional call (a decision you hadn't answered) is logged in the relevant
  `plans/<svc>/brainstorming.md` and flagged in an issue comment for your review.

The machinery is a reusable workflow —
[`.claude/workflows/overnight-board.js`](../.claude/workflows/overnight-board.js) — not tied to
any one issue, so future nights just need issues dropped into **Ready**.

---

## Where design happens

Nothing is built before it is thought through in [../plans/](../plans/): `plan.md` holds the
system-level design (the people, the jobs, the scope), and each service has its own
`<name>_service/brainstorming.md`. Decisions are recorded there as they land; the code follows the
doc, not the other way round.

The database schema is mirrored for humans in [database-schema.md](database-schema.md) (one mermaid
`erDiagram` per service, kept in step with the migrations), and non-trivial cross-service RPC flows
are documented under [services/](services/).
