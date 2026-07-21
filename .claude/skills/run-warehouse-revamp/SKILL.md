---
name: run-warehouse-revamp
description: Run, start, build, launch, drive, screenshot, or smoke-test the warehouse_revamp app (Go Connect API + React/Vite UI + Postgres). Use when asked to see a screen, screenshot the UI, check a page renders, verify a change in the real running app, call an RPC by hand, or bring the stack up or down.
---

# Run warehouse_revamp

Go Connect-RPC API (`:8080`) + React/Vite UI (`:5174`) + Postgres (`:5433`, docker). Everything
below is driven by **`.claude/skills/run-warehouse-revamp/driver.mjs`** — a Node script that
starts the stack, logs in, drives the real browser, screenshots pages, and calls RPCs.

All paths are relative to the repo root. Run every command from there.

> **The owner usually already has the dev stack running** and previews on it. Check with `status`
> before starting anything, and never kill servers you did not start (`down` enforces this).

## Prerequisites

Already present on this machine: Node 22, Go 1.25, Docker, and Playwright's chromium in
`frontend/node_modules`. The driver needs no dependencies of its own.

```sh
docker compose up -d          # postgres :5433, redis :6380
```

## Run (agent path)

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs status
```

```
target: dev  api=http://localhost:8080  ui=http://localhost:5174

containers:
  warehouse_revamp_redis	Up 4 hours (healthy)
  warehouse_revamp_postgres	Up 4 hours (healthy)

servers:
  api http://localhost:8080/healthz  -> 200
  ui  http://localhost:5174           -> 200
```

If the servers are down, `up` starts them in the background — and reuses anything already up, so
it is safe to run against the owner's stack:

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs up
```

```
✓ api already up at http://localhost:8080 (reusing)
✓ ui already up at http://localhost:5174 (reusing)
  waiting for api (http://localhost:8080/healthz)  up (200)
  waiting for ui (http://localhost:5174)  up (200)

✓ stack up
```

### The commands

| Command | What it does |
| --- | --- |
| `status` | containers + api/ui reachability |
| `setup` | `docker compose up -d`, migrate **every** service in order, seed the dev fixture |
| `up` | start backend + vite in the background, wait for health |
| `down` | kill **only** what this driver started (verifies the ports released) |
| `flow` | real login form → walk real screens → screenshots. The smoke test. |
| `shot <route...>` | authenticated screenshot per route |
| `eval <route> "<js>"` | run JS in the page, print the result |
| `login` | print a bearer token for `dev` |
| `api <Svc/Method> [json]` | authenticated Connect call |

Flags: `--target dev\|test` (default `dev`), `--team <id>`, `--full` (full-page shot),
`--headed`, `--anon` (api only).

Screenshots land in `.claude/skills/run-warehouse-revamp/shots/`, server logs in `logs/`. Both
are gitignored.

### Seeing a screen

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs shot /inventories/racks /costs --team 13
```

```
✓ /inventories/racks → ...\shots\inventories-racks.png   [Racks]
✓ /costs → ...\shots\costs.png   [Costs]
```

It prints the page's first heading, and reports console errors, failed requests, and any 4xx/5xx
— the failures a screenshot alone hides. **Then read the PNG.** A page that renders an error
boundary still screenshots fine.

`--team` matters more than it looks — see Gotchas. Dev team ids: **1** Root · **13** Dev
Warehouse · **14** Dev Selling.

### The smoke test

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs flow
```

```
→ login form
✓ signed in as dev → http://localhost:5174/
✓ /products — found "Products" → ...\shots\flow-2-products.png
✓ /teams — found "Teams" → ...\shots\flow-3-teams.png
✓ /users — found "Users" → ...\shots\flow-4-users.png

✓ flow complete
```

This is the only command that types into the real login form; everything else seeds the token
directly. Exits non-zero if a screen does not render. Run it after touching auth, routing, or the
layout.

### Reading live state out of a page

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs eval /teams \
  "Array.from(document.querySelectorAll('table tbody tr')).map(r=>r.innerText.split('\t')[0])"
```

```
[
  "DS\n\nDev Selling\n\nSelling\n",
  "DW\n\nDev Warehouse\n\nWarehouse\n",
  "RT\n\nRoot Team\n\nRoot\n"
]
```

### Calling an RPC

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs api \
  warehouse.user.v1.UserService/TeamAccessList '{"page":{"page":1,"limit":20}}'
```

Logs in as `dev` and sends the bearer token. Prints `HTTP <status>` then the JSON body — a
validation failure comes back as a readable `buf.validate` violation.

## From a clean machine

`setup` is the whole path: docker up, migrate all 11 services in dependency order, seed the
fixture. Verified end to end against the test database:

```sh
node .claude/skills/run-warehouse-revamp/driver.mjs setup --target test
```

```
→ migrate up --service shipping_service
2026/07/21 15:04:25 OK   00001_create_shippings.sql (19.7ms)
→ seed dev fixture
2026/07/21 15:04:25 dev fixture seeded: teams DEVWH/DEVSELL, users dev/wh_owner/wh_staff/seller

✓ setup complete — login with dev / devpassword123
```

Migration order is a contract: `team_service` seeds team 1, and `user_service`'s root seed puts
`ROLE_ROOT` *in team 1*. No foreign key enforces it. The driver hardcodes that pair first and
discovers the rest from the filesystem, so a new service is picked up automatically.

**Against the dev database, `setup` runs migrations on the data the owner reviews.** It is
idempotent, but prefer `--target test` unless you actually mean to migrate dev.

## Two stacks

| | api | ui | database |
| --- | --- | --- | --- |
| `--target dev` (default) | 8080 | 5174 | `postgres` — the owner's review data |
| `--target test` | 8081 | 5175 | `warehouse_test` — wiped by every e2e run |

Use `test` for anything destructive — but **only when the e2e suite is not running.** `up` and
`down` refuse outright if they detect a Playwright run:

```
✗ refusing to down --target test: a Playwright run is in progress (pid 25264, 38420).
  The e2e suite owns :8081/:5175 and restarts anything killed there.
  Wait for it to finish, use --target dev, or pass --force if you are certain.
```

Everything on `--target dev` (`shot`, `eval`, `api`, `flow`) is unaffected and works fine while
e2e runs — different ports, different database.

## Credentials

`dev` / `devpassword123` — ADMIN in the root team, owner of both sample teams. Created by
`seed dev`, so it exists only after `setup`. Override with `DRIVER_USER` / `DRIVER_PASSWORD`.

## Run (human path)

```sh
cd backend && go run ./cmd/app_development     # :8080
cd frontend && npm run dev                     # :5174
```

Two terminals, Ctrl-C each. The UI needs both.

## Test

```sh
cd frontend && npm run e2e        # Playwright, starts its own servers on 8081/5175
cd backend && go test ./...
```

## Gotchas

- **Almost every screen is team-scoped, and the default team is Root — where most of them are
  empty.** `shot /products` with no `--team` renders "No products found" against a perfectly
  healthy product service, because the active team is Admin Team (Root). It looks exactly like a
  bug and is not one. Pass `--team 13` (warehouse) or `--team 14` (selling). The nav itself
  changes too: Root shows no Products/Inventories submenu at all, so a missing menu item is
  usually the wrong team, not a broken route.
- **Git Bash rewrites route arguments.** `/costs` reaches the driver as
  `C:/Program Files/Git/costs`, and the app renders React Router's "Unexpected Application
  Error!" — which reads as a broken route, not a mangled argument. The driver detects and undoes
  this, but if you write your own script use PowerShell, or `MSYS_NO_PATHCONV=1`, or drop the
  leading slash (`costs` works).
- **`CLAUDE.md`'s documented smoke test is dead.** The `HelloService/SayHello` curl returns
  `404 page not found` — the service was deleted once real domains landed. Use `/healthz` or the
  `api` command instead.
- **A `PageFilter` needs a 1-based `page`, not just a `limit`.** `{"page":{"limit":5}}` is
  rejected with `page.page: must be greater than or equal to 1`.
- **Login is on `AuthService`, not `UserService`** — `warehouse.user.v1.AuthService/Login`. Both
  are mounted by `user_service`, and guessing the wrong one gives a bare 404.
- **A running `npm run e2e` will resurrect anything you kill on :8081/:5175.** Playwright's
  `webServer` block owns both, and its manager restarts them — so a teardown appears to succeed,
  the port reads clean, and seconds later the server is back. This cost real debugging time before
  the cause was found: it looked like a broken teardown, and it was somebody else's test run.
  `up`/`down --target test` now refuse while Playwright is running.
- **`down` cannot rely on the pid it spawned.** `go run` is a *three*-hop chain — the `go.exe` we
  spawn re-execs the toolchain `go.exe`, which execs the binary from the build cache — and vite is
  `cmd.exe → npm node → vite node`. The listener's parent chain no longer leads back to the
  recorded pid, so `taskkill /T` reports success and the port stays bound. Worse, a `go run` still
  building when its binary is killed starts a *fresh* listener a second later. `down` therefore
  kills the recorded tree, sweeps the port, walks up to 4 supervisor levels, and requires two
  consecutive clean checks before declaring success.
- **`down` with no tracked state deliberately does nothing.** The servers on :8080/:5174 are
  usually the owner's; a blind port sweep would kill the session they are previewing on.
- **Vite binds `[::1]` only.** `localhost` works; a literal `127.0.0.1:5174` does not.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `TypeError: Cannot read properties of undefined (reading 'launch')` | Playwright is CJS — dynamic-importing it by absolute path drops the named exports. The driver `require()`s it from `frontend/node_modules`. If it reappears, run `npm install` in `frontend/`. |
| `Error: spawn EINVAL` starting vite | Node ≥20 refuses to spawn `npm.cmd` without a shell. The driver passes `shell: true` on win32. |
| `page.goto: Cannot navigate to invalid URL … localhost:5175C:/Program Files/Git/teams` | Git Bash path conversion — see Gotchas. |
| `Cannot find module '…\backend\.claude\skills\…\driver.mjs'` | The shell's cwd drifted. `cd` to the repo root; the path is relative to it. |
| Screens render but every list is empty | Wrong team — pass `--team 13` or `--team 14`. |
| `ports still bound after teardown` | Usually a Playwright run restarting them. Check with `Get-CimInstance Win32_Process \| Where-Object { $_.CommandLine -like '*playwright*test*' }`; otherwise `netstat -ano \| grep ":8081 "` then `taskkill /PID <pid> /T /F`. |
| A server you killed comes back seconds later | A Playwright `webServer` owns it. Let the e2e finish. |
| Backend won't start, `logs/backend.log` shows a database error | `docker compose up -d`, then `setup` — the database exists but has no schema. |
| `FATAL: database "warehouse_test" does not exist` — but you ran `setup --target test` earlier | The e2e drops it on teardown, so a test database is never durable between e2e runs. Re-run `setup --target test`. |
