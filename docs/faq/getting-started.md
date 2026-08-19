# FAQ — Getting started

New here? Read this file top to bottom once. The rest of the FAQ is lookup, this one is a path.

---

## I just joined the team. What do I read, and in what order?

Four things, in this order — about an hour:

| # | Read | Why |
| --- | --- | --- |
| 1 | [../readme.md](../readme.md) | the map: what the repo is, how the sides fit together |
| 2 | [../../CLAUDE.md](../../CLAUDE.md) | **the rules.** Not optional — most review comments are a rule from here |
| 3 | [../../plans/plan.md](../../plans/plan.md) | what we are actually building, and what is still undecided |
| 4 | [../../guidelines/](../../guidelines/) | the authoritative service/RPC shapes you must follow when writing code |

Then get it running (below), click through the UI, and pick a **Ready** issue off the board.

> `plans/` and `disscuss/` are *thinking*, not truth. `guidelines/`, `docs/` and the code are.
> See [workflow.md](workflow.md#where-do-i-write-a-design-idea--plans-or-disscuss).

---

## How do I get everything running locally?

Prerequisites: Go, Node, Docker. All commands from the **repo root** unless stated.

```sh
docker compose up -d                          # Postgres :5433, Redis :6380
cd backend && go run ./cmd/tool migrate up    # prompts: database, then service — apply for EVERY service
cd backend && go run ./cmd/tool seed dev      # sample teams + logins (development only)
cd backend && go run ./cmd/app_development    # the API on :8080
cd frontend && npm install && npm run dev     # the UI on :5174
```

Both servers must run — the UI talks to the API. Open <http://localhost:5174>.

---

## How do I log in? The database has no users.

A fresh migration creates the root account with an **empty password**, which bcrypt can never
match — deliberately, so no default password can ever ship to production. Give it one, or seed the
development fixture:

```sh
cd backend && go run ./cmd/tool seed root --password <yours>   # just the root account
cd backend && go run ./cmd/tool seed dev                       # teams + several accounts (recommended)
```

`seed dev` is idempotent, and **hard-refuses a production target**. It creates:

| Username | Role | Team |
| --- | --- | --- |
| `dev` | ADMIN in the root team, owner in both sample teams | all |
| `wh_owner` / `wh_staff` | warehouse owner / staff | Dev Warehouse |
| `seller` | team owner | Dev Selling |

Password for all of them: `devpassword123`, or whatever you pass to `--password`.

To change a password later, use the operations CLI:
`go run ./tools/san user reset-password --username dev`.

---

## The app runs but every screen is empty. What did I miss?

In order of likelihood:

1. **Migrations were only applied for one service.** `migrate up` prompts for a *service* and
   applies that one. Every service owns its own migrations — run it once per service.
2. **No seed.** `go run ./cmd/tool seed dev`, and `seed categories` for the product taxonomy.
3. **You are in the wrong team.** Most data is team-scoped; use the team switcher.
4. **The API is not running**, or the browser console shows a CORS/connection error — the UI needs
   `:8080` up.

---

## Why are the ports 5433 / 6380 / 5174 instead of the usual ones?

Because other projects on the same machine already hold the defaults, and this system must never
share their database, keyspace, or dev server.

| Thing | Port | Default it avoids |
| --- | --- | --- |
| Postgres | **5433** | 5432 |
| Redis | **6380** | 6379 |
| UI dev server | **5174** | 5173 (`strictPort` — a collision fails loudly) |
| API | 8080 | — |
| Storybook | 6006 | — |
| e2e API / UI | 8081 / 5175 | so e2e can run beside your dev servers |

---

## What should I work on?

The GitHub Project board — project #2 "Warehouse Revamp", owner `pdcgo`. Take something from
**Ready**. See [workflow.md](workflow.md#how-do-i-pick-up-an-issue).

---

## My question isn't in this FAQ. What do I do?

Ask in the team channel — and then **write the answer here**, in the same day. That is the whole
point of this folder: the second person to ask should find it instead of asking.
See [readme.md](readme.md#how-do-i-add-a-new-question).
