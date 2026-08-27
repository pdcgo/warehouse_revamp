# Warehouse Revamp

A warehouse management system, **built new from first principles** — not a port of anything. It is
in active design: requirements are written in [business/](business/) and [technical/](technical/),
and screens are designed before the API and the schema are derived
from them.

This document is the map. For the authoritative detail, follow the links.

> **New to the team?** Start with the [FAQ](faq/) — [faq/getting-started.md](faq/getting-started.md)
> covers the first day, and the rest is every question people have already had to ask. When you get
> an answer that is not in there, add it.

---

## What it is

A single repository holding three sides of one system, plus the design record:

```
proto/       the API contract — one buf module; one `buf generate` emits both sides
backend/     Go server (Connect RPC over net/http), one directory per service
tools/san/   the operations CLI — top-level, because it is a tool of the repo, not of the server
frontend/    React + TypeScript (Vite) + Chakra UI v3, a Connect-ES client
docs/business/   what the business needs — owner-written
docs/technical/  how it gets built — owner-written
guidelines/  programmer-authoritative service + code guidelines
docs/         human-facing docs (this file, the FAQ, the schema, per-service RPC flows)
```

The Go module is rooted at the repository, so `backend/` and `tools/` are one module — run
`go build|vet|test ./...` from the root, not from `backend/`.

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
revenue work waits on.

---

## Running it locally

Prerequisites: Go, Node, and Docker (for Postgres). All commands assume the repo root.

```sh
docker compose up -d                      # Postgres on :5433 (and Redis on :6380)
go run ./tools/san migrate up # apply migrations (prompts for db + service)
cd backend && go run ./cmd/app_development # the API on :8080
cd frontend && npm install && npm run dev  # the UI on :5174 (talks to :8080)
```

Both servers must run for the UI to reach the API. More commands (lint, generate, test, e2e,
migrations) are in the [top-level guide](../CLAUDE.md#commands).

### Tools

**One CLI:** [`tools/san`](tools/san.md). It owns the schema and the fixtures (`migrate`, `seed`,
`db`, `region`), the actions on real data through the services (`user reset-password`), and serving
the checkout to a coding agent (`remote`, `remote mcp`). It can be pointed at production behind a
typed confirmation. It sits at the repo root rather than under `backend/`, because it is a tool of
the repository, not a part of the server — and it finds the checkout itself, so it runs from any
directory inside it.

```sh
go run ./tools/san migrate up-all                       # every service, fresh database
go run ./tools/san user reset-password --username ani
```

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

## Where design happens

**[development_lifecycle.md](development_lifecycle.md) is the development flow** — how a requirement
becomes working software. Three trees share one path shape, so a context has the same coordinates in
each:

```
docs/business/<big>/<small>.md           what the business needs — the owner writes it
docs/technical/<big>/<small>.md          how it gets built      — the owner writes it
docs/development_state/<big>/<small>.md  how far it has got     — the agent writes it
```

Beside any owner doc an agent may create exactly two files: a **`_clarify.md`** (its open questions
and proposed design — a question set, never an answer) and a **`_decision.md`** (what the owner
decided, recorded before it is acted on, append-only). Nothing else in those trees is the agent's to
create. [../guidelines/](../guidelines/) holds the programmer-authoritative service and code
guidelines.

Analysis is **frontend-first**: pages and components are built in Storybook with mock wiring so a
screen can be previewed before any backend exists, and the contract is derived from what the page
must show and do.

The database schema is mirrored for humans in [database-schema.md](database-schema.md) (one mermaid
`erDiagram` per service, kept in step with the migrations), and non-trivial cross-service RPC flows
are documented under [services/](services/). The operations CLI is documented in
[tools/san.md](tools/san.md), which is updated in the same commit as any change to it.
