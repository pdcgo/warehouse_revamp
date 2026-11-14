# `san` — the operations CLI

`san` is the tool for **acting on real data by hand**: the things an operator does to a running
system, not the things a developer does to a codebase. It lives at the **repository root** —
[tools/san/](../../tools/san/), not under `backend/`, because it is a tool of the repo rather than a
part of the server — and runs from there.

```sh
go run ./tools/san user reset-password --username ani
```

> ⚠ This tool can act on **production**. Every run picks a database first, and choosing Production
> makes you type the word `production` before anything happens.

---

## One CLI, seven jobs

`san` covers the whole life of the project's data and the environment around it.

| | Commands | |
| --- | --- | --- |
| **the schema** | [`migrate`](#migrate) | goose, per service (HARD RULE 3) |
| **the fixtures** | [`seed`](#seed) · [`db`](#db) · [`region`](#region) | dev data, the test database, reference data |
| **operations** | [`user reset-password`](#user-reset-password) · [`user root add` / `remove`](#user-root-add--remove) · [`product recompose-codes`](#product-recompose-codes) · [`shop grant-current-cs`](#shop-grant-current-cs) | acts on real data, through the real services |
| **the workspace** | [`remote`](#remote) · [`remote mcp`](#remote-mcp) · [`remote refresh-token`](#remote-refresh-token) | serve this checkout to a coding agent |
| **the local stack** | [`dev setup`](#dev-setup) · [`dev run`](#dev-run) | make a checkout runnable, then run the containers, the API and the UI in one terminal |
| **the tests** | [`test measure`](#test-measure) · [`test affected`](#test-affected) · [`test smoke`](#test-smoke) · [`test full`](#test-full) · [`test accept-run`](#test-accept-run) · [`test report` · `test slice`](#test-report--test-slice) | measured testing: measure the change against the last green full run, run what it reaches, run the full suites only when due |
| **the deployment** | [`deploy`](#deploy) | ship one service to Cloud Run — built by Cloud Build, never migrated |

```mermaid
flowchart LR
    subgraph san["tools/san — one binary"]
        M["migrate"]
        S["seed · db · region"]
        U["user reset-password · user root"]
        R["remote · remote mcp · refresh-token"]
        V["dev setup · dev run"]
        T["test measure · affected · smoke · full"]
        D["deploy"]
    end
    M -->|"shapes the schema"| DB[(Postgres)]
    S -->|"puts rows in it"| DB
    U -->|"changes what is IN it, through the services"| DB
    R -->|"runs shell commands in the checkout"| WS[/"the working tree"/]
    V -->|"starts the API and the UI from"| WS
    V -->|"setup migrates and seeds the LOCAL one"| DB
    T -->|"fingerprints, and runs the tests of"| WS
    T -->|"records into e2e_report/"| WS
    D -->|"uploads backend/ from"| WS
    D -->|"Cloud Build, then a new revision"| CR["Cloud Run"]
```

> **This used to be two binaries.** `migrate`, `seed`, `db` and `region` lived in
> `backend/cmd/tool`, split from `san` on the argument that a developer's tool and an operator's
> tool are used at different moments by different people. That is true of the **commands** and was
> never true of the **binary**: the moment matters to whoever is typing, and a `--help` line carries
> it — whereas *"which of our two programs owns `migrate`"* is a fact every new person has to be
> told and nothing in the tree reveals. The split also had no seat for `deploy`, which belongs to
> neither half.
>
> What the merge does **not** collapse is the guard rails. Every command that touches a database
> still resolves it through [`san_dbtarget`](../../backend/pkgs/san_dbtarget/), so the
> `type "production" to continue` prompt protects all of them rather than one binary's worth.

**Run it from anywhere in the checkout.** `migrate` and `seed` used to require standing in
`./backend` — the services directory was a bare relative path, and the error message for getting it
wrong had to say so out loud. `san` now walks up from the working directory to find the checkout,
so these are all the same command:

```sh
go run ./tools/san migrate up --service user_service        # from the repo root
cd backend  && go run ../tools/san migrate up               # from backend/
cd frontend && go run ../tools/san migrate up               # from frontend/
```

Outside a checkout it says so, rather than quietly looking in the wrong place.

---

## Commands

| Command | What it does |
| --- | --- |
| [`migrate`](#migrate) | Run goose migrations for one service, or `up-all` for every service |
| [`seed`](#seed) | Development fixtures — `root`, `dev`, `categories` |
| [`db`](#db) | Create, reset and drop the **test** database (`warehouse_test`) |
| [`region`](#region) | Build and load region_service's reference data |
| [`dev setup`](#dev-setup) | Make a checkout runnable: submodules, containers, every migration, the dev logins, the warehouse fees, categories, regions, `npm install`. Safe to re-run |
| [`dev run`](#dev-run) | Start the containers, the API and the UI in one terminal — Ctrl-C stops all of it |
| [`test measure`](#test-measure) | Fingerprint the source files against the last green full run (`e2e_report/last_green.json`): the areas changed, their risk, whether the full run is **due** or **overdue**, and the one-line ask |
| [`test affected`](#test-affected) | The e2e specs that call a changed RPC, open a changed page or use a changed component, and the smoke set. `--run` runs them |
| [`test smoke`](#test-smoke) | Run the smoke set — five key flows from `frontend/e2e/smoke.txt`, under 5 minutes. `--dry-run` checks every entry still names one test |
| [`test full`](#test-full) | The full go test, Storybook and e2e on a **frozen copy** of the folder; `last_green.json` moves only when all of it is green. The e2e runs on **ONE worker** by default (`--workers N` for more, on request) — its own database, ports and events project, so the live tree's Go DB tests, smoke and Storybook go on beside it. Run it when measured due and the owner said yes. `--dry-run` prints the plan. A story or spec file that only failed to **load** is re-run once, by itself, in the same run |
| [`test accept-run`](#test-accept-run) | Make an ENDED full run the green baseline when its only failures were load failures: re-run each such file once now, in this tree; `last_green.json` moves to **that run's** fingerprint. Refuses while any failed check remains |
| [`test report` · `test slice`](#test-report--test-slice) | Print `e2e_report/latest.md` and the recent runs · log the files a slice changed |
| [`user reset-password`](#user-reset-password) | Set a user's password without knowing the old one |
| [`user root add` / `remove`](#user-root-add--remove) | Make an account a Root, or take Root from one — never the last |
| [`supplier move`](#supplier-move) | Copy inventory_service's suppliers and stores into supplier_service, ids kept. One-shot, safe to re-run |
| [`supplier backfill-figures`](#supplier-backfill-figures) | Fold the restocks accepted before *Restock Accepted* existed into the supplier figures. Once — a second run folds nothing |
| [`product recompose-codes`](#product-recompose-codes) | Put each team's code in front of the product codes written before codes were composed on write. Safe to re-run — a second run changes nothing |
| [`shop grant-current-cs`](#shop-grant-current-cs) | The shop write gate's rollout: grant every current CS every live shop of their team, through `ShopUserAdd`. `--dry-run` prints it first. Safe to re-run — a second run adds nothing |
| [`document sweep-generated`](#document-sweep-generated) | Delete the generated downloads older than 7 days — merged label PDFs, table exports, order exports — now, as the server's daily sweep does. Uploads never. `--dry-run` counts first. Safe to re-run — a second run finds nothing |
| [`report refold`](#report-refold) | Rebuild ONE scope's day of an EVENT-FED report from its log — a shop's or a person's settlement day (every later day's carry follows), a seller team's order metrics, a supplier's restock figures or Penjualan — the repair for a day that is wrong while the log is right. `--dry-run` prints it first. Safe to re-run — a second run changes nothing |
| [`pubsub ensure`](#pubsub-ensure) | Make every declared event topic and subscription exist, with the safe defaults |
| [`pubsub redrive`](#pubsub-redrive) | Re-publish everything sitting in a dead-letter queue back to its topic |
| [`pubsub releases`](#pubsub-releases) | List and replay the dead-lettered stock releases (`InventoryTxCancel`, `OrderCancelled`) through inventory's own listener |
| [`remote`](#remote) | Serve this checkout to a coding agent — shell commands, streamed, behind a bearer token kept per workspace |
| [`remote mcp`](#remote-mcp) | Serve this checkout as **MCP tools** — the command for Claude Web and any other client we did not write, behind a tunnel |
| [`remote refresh-token`](#remote-refresh-token) | Push the stored token's deadline out — same token, so nothing has to be re-pasted |
| [`remote exec`](#remote-exec) | The client: run one command on a `remote` server and stream its output |
| [`remote get` · `remote put`](#remote-get--remote-put) | The client: move a file to or from the server, byte for byte |
| [`deploy`](#deploy) | Build one service with Cloud Build and deploy it to Cloud Run — today `shipment_service`. Never migrates |

*(Every new one is added to this table — see [Adding a command](#adding-a-command).)*

**`remote`, `pubsub`, `dev run`, `test` and `deploy` touch no database**, so they never ask Local/Production and need
no Postgres running (`dev run` starts the containers, and that is all; the e2e that `test` runs uses its own
`warehouse_test` through Playwright's setup, as it always did). `--dsn` is meaningless to all
five. `pubsub` has its own target flags instead — `--project`, and `--emulator` for the local broker;
`deploy` has `--project` and `--region`. The one exception is **`pubsub releases replay`** (without `--dry-run`): it
releases stock in inventory's tables, so it asks Local/Production (or takes `--dsn`) like any command that writes.

**`dev setup` touches only the local one, and never asks.** It refuses to run at all when `--dsn` or
`DATABASE_URL` is set — see [local only](#dev-setup).

---

## Global options

| Flag | Env | Meaning |
| --- | --- | --- |
| `--dsn` | `DATABASE_URL` | Postgres DSN. **Skips the Local/Production prompt** — the non-interactive path for scripts and CI. |

It is a persistent flag, so it reads the same on either side of the subcommand:

```sh
go run ./tools/san --dsn "$DSN" user reset-password --username ani
go run ./tools/san user reset-password --username ani --dsn "$DSN"
```

With no `--dsn`, the tool asks:

```
Database:  ▸ Database Local          → POSTGRES_HOST/PORT/USER/PASSWORD/DB, defaults matching docker-compose
             Database Production     → PRODUCTION_DATABASE_URL, and you must type "production" to continue
```

Environment used when a command builds its services:

| Env | Default | Why it matters |
| --- | --- | --- |
| `REDIS_ADDR` | *(empty — in-process cache)* | ⚠ **Set it when acting on a deployment.** A reset evicts the user's cached roles; with no Redis the tool evicts a cache only it can see, and running servers keep serving that user's cached roles for up to ~1 minute. The password change itself is immediate either way. |
| `JWT_SECRET`, `TOKEN_TTL` | dev values | Build the signer. No command mints a token today. |
| `INTERNAL_BASE_URL` | `http://localhost:8080` | Where cross-service clients point. No command reaches that path today. |
| `DOCUMENT_STORAGE_DIR` | *(empty — the same temp-dir default as the server)* | The server's document store. [`document sweep-generated`](#document-sweep-generated) deletes objects there, so point it at the store the server writes to — the server reads the same variable. |

---

## `migrate`

Runs goose against **one service's** migrations. Migrations are per-service (HARD RULE 3): files
live in `backend/services/<service>/db_migrations/`, and applied state is tracked in that service's
own `<service>_version` table — which is what keeps services independently migratable.

```sh
go run ./tools/san migrate create add_users --service user_service   # writes a .sql file, no DB
go run ./tools/san migrate up                                        # prompts: database, then service
go run ./tools/san migrate up-all                                    # every service, dependency order
go run ./tools/san migrate status --service user_service
```

| Flag | Notes |
| --- | --- |
| `--service` / `-s` | Which service. **Prompts when omitted.** Discovered from the filesystem, so the list never goes stale — every `backend/services/*` with a `db_migrations` of its own; a service that owns no table (`mcp_service`) has nothing to migrate and is not offered |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt. Not needed for `create` |

**Two prompts, in this order: database, then service.** The dangerous choice comes first, so
Production is answered before anything else is decided rather than after.

```mermaid
sequenceDiagram
    actor Op as Operator
    participant CLI as san migrate
    participant Target as san_dbtarget
    participant Goose as goose
    participant DB as Postgres

    Op->>CLI: san migrate up
    alt create — writes a file, touches no database
        CLI->>Op: which service?
        CLI->>Goose: create <name> sql
        Goose-->>Op: a new .sql under the service's db_migrations
    else anything else
        CLI->>Target: Resolve(--dsn)
        Target-->>Op: Database Local or Database Production
        Op-->>Target: types "production" if that is the choice
        CLI->>Op: which service?
        CLI->>Goose: SetTableName(<service>_version), SetDialect(postgres)
        CLI->>Goose: run against that service's db_migrations
        Goose->>DB: apply
        Goose-->>Op: the migration log, with the target named
    end
```

**`up-all` is the fresh-database shortcut.** It migrates every service that has migrations, in
dependency order, asking only for the database. The order is a **contract, not a preference**:
`team_service` seeds team 1 and `user_service`'s root-user seed puts `ROLE_ROOT` *in team 1*. There
is no cross-service foreign key to enforce it — a service owns its own tables — so the wrong order
produces a role pointing at a team that does not exist yet. `inventory_service` comes third: its `00023`
renames its old supplier tables to `legacy_*`, freeing the names `supplier_service`'s `00001` creates —
every service shares one database ([the-supplier-gets-its-own-service](../business/supplier/context_decision.md#the-supplier-gets-its-own-service)).
A test pins the order (`TestMigrationOrderPinsTheDependencies`).

### Errors you should expect

| Message | Cause |
| --- | --- |
| `unknown service "x" — have: [...]` | Typo — or a service with no `db_migrations` (`mcp_service`). The list is the filesystem, so anything missing from it does not exist |
| `not inside a warehouse_revamp checkout: no go.mod beside backend/services …` | Run from outside the repo |
| `a goose command is required (up, down, status, create, ...)` | `san migrate` with no goose verb |
| `create needs a name: migrate create <name> --service <svc>` | `create` with no migration name |

---

## `seed`

Development fixtures. **Never production data**, and deliberately not a migration — a migration runs
everywhere, including production, and anything inside one *will* eventually execute there. ⚠ The one exception is
decided: root's development password is written by a migration, and production replaces it with `seed root`.

```sh
go run ./tools/san seed root --password <secret>   # the root account, nothing else
go run ./tools/san seed dev  --password <secret>   # teams + several accounts (development)
go run ./tools/san seed categories                 # the product taxonomy
go run ./tools/san seed categories -f other.json
```

| Sub-command | | |
| --- | --- | --- |
| `root` | Sets the root account's password | A migration (`00010`) gives root the **development** password `root1234` while it has none ([the-migration-writes-the-dev-root-password](../business/user/context_decision.md#the-migration-writes-the-dev-root-password)). It is public in this repository, so **a production database runs this right after its first migration** |
| `dev` | Teams, several logins, and Dev Warehouse's fee | Development only. The fee is written only while Dev Warehouse has none: the decisions' worked example — 2.5%, floor 2.000, cap 20.000 ([the-fee-has-a-floor-and-a-cap](../business/teams/warehouse/context_decision.md#the-fee-has-a-floor-and-a-cap)). Without a rate, a warehouse takes no orders ([a-warehouse-with-no-rate-takes-no-orders](../business/teams/warehouse/context_decision.md#a-warehouse-with-no-rate-takes-no-orders)) |
| `categories` | The product taxonomy from JSON | `-f` to point at another file |

---

## `db`

Manages **`warehouse_test`** — the database every automated test runs against. It is a *separate*
database from the development one (`postgres`) the owner reviews on, on the same Postgres instance,
so a test run can never read or corrupt review data.

```sh
go run ./tools/san db ensure-test    # create it if absent — never drops
go run ./tools/san db reset-test     # drop and recreate it empty
go run ./tools/san db drop-test      # clean up after a run

# a full run's e2e worker's own database, and the template it is cloned from (test full)
go run ./tools/san db reset-test --name warehouse_test_w1 --template warehouse_test_tpl
go run ./tools/san db drop-test --name warehouse_test_w1
```

| Flag | |
| --- | --- |
| `--name` | Which test database (default `warehouse_test`). Only `warehouse_test` or `warehouse_test_<suffix>` — anything else (the development `postgres`) is refused |
| `--template` | `reset-test` only: create it as a **copy** of this database (`CREATE DATABASE … TEMPLATE …`, about a second) instead of empty. Same name rule. Postgres refuses while anything is connected to the template |

> ⚠ **This command's flag is `--admin-dsn`, not `--dsn`.**
>
> You cannot drop the database you are connected to, so these commands need a connection to a
> *different* (maintenance) database — by default the local Postgres on `dbname=postgres`.
>
> While these lived in their own binary the flag could safely be called `--dsn`, because there was
> no root flag to inherit from. `san`'s root `--dsn` reads `DATABASE_URL`, which during a test run
> points at **`warehouse_test` itself** — the exact database `reset-test` is about to drop. The
> rename is what stops that collision from being silent.

`ensure-test` exists for a Playwright ordering problem: Playwright may start the backend web server
*before* global-setup runs, and the backend would otherwise crash on a missing database. It creates
and never drops, so it is safe to run beside a live suite; global-setup still resets and migrates.

---

## `region`

`region_service`'s reference data: Indonesia's administrative regions and their postcodes.

```sh
go run ./tools/san region build-seed   # download the PINNED sources, write regions.csv
go run ./tools/san region load-seed    # load the CSV into a database (idempotent upsert)
```

| Sub-command | Flags | |
| --- | --- | --- |
| `build-seed` | `--out`, `--wilayah-sha`, `--kodepos-sha` | Reproducible: same SHAs in, same CSV out |
| `load-seed` | `--file`, `--dsn` | Run it after `migrate up --service region_service` |

**Pinned by commit SHA, never a branch.** Upstream `master` moves whenever the government revises
the wilayah (roughly yearly), and an unpinned fetch would silently change the country under us.
Bumping the edition is a deliberate act: change the SHA constants in
[`tools/san/region.go`](../../tools/san/region.go), re-run, review the diff.

**Why the rows are loaded by the tool and not by the migration.** Postgres runs in Docker and cannot
read a host file, so a server-side `COPY … FROM '<path>'` inside a `.sql` migration would not work.
A Go goose migration could embed the CSV, but would then have to be registered into *every* binary
that runs goose — `tools/san` **and** `pkgs/san_testdb` — which is a footgun the moment somebody
forgets the blank import.

Both `--file` and `--out` default to the checked-in seed, resolved **against the repository root**,
so they find it wherever the command is run from. An explicit relative path is still relative to
your working directory.

---

## `dev setup`

Makes a checkout runnable: everything [`dev run`](#dev-run) assumes is already there. Run it on a new
machine, and **again after a pull** that brings migrations or changed seeds. Every step is
idempotent, so there is no separate "update" command.

```sh
go run ./tools/san dev setup               # all of it
go run ./tools/san dev setup --no-docker   # the containers are already up
```

| | Step | The same as |
| --- | --- | --- |
| 1 | check out a submodule a plain `git clone` left empty | `git submodule update --init` |
| 2 | `docker compose --profile pubsub up -d --wait` — Postgres, Redis and the Pub/Sub emulator | |
| 3 | the emulator's topics, and subscriptions that PUSH to the dev API ([the-emulator-pushes-locally](../technical/event_architecture/context_decision.md#the-emulator-pushes-locally)) | [`pubsub ensure --project warehouse-dev --emulator --push-base-url http://host.docker.internal:8080`](#pubsub-ensure) — `PUBSUB_PUSH_BASE_URL` overrides the URL |
| 4 | migrate every service, in dependency order | [`migrate up-all`](#migrate) |
| 5 | the suppliers inventory_service set aside, into supplier_service | [`supplier move`](#supplier-move) |
| 6 | the supplier figures of every restock accepted before the event existed — once | [`supplier backfill-figures`](#supplier-backfill-figures) |
| 6b | the product codes written before a code was composed — each team's code put in front, once | [`product recompose-codes`](#product-recompose-codes) |
| 7 | the dev logins: `dev`, `wh_owner`, `wh_staff`, `seller`, and Dev Warehouse's fee while it has none | [`seed dev`](#seed) |
| 8 | the product-category tree | [`seed categories`](#seed) |
| 9 | Indonesia's 91,599 regions | [`region load-seed`](#region) |
| 10 | `npm install` in `frontend/` | |

Steps 3–9 call **the same function** as their own command, so setup cannot drift from running them
one at a time. Steps 2 and 3 are the same ones [`dev run`](#dev-run) starts with — see
[the emulator and its topics](#the-emulator-and-its-topics).

| Flag | |
| --- | --- |
| `--no-docker` | Skip `docker compose up`. The topics are still made if the emulator answers, and a missing one is only a warning |
| `--password` | The password of every dev account. Default `devpassword123`, env `DEV_PASSWORD` |

```mermaid
flowchart TD
    G{"--dsn or DATABASE_URL set?"} -->|"yes"| X["refuse — nothing has run"]
    G -->|"no"| R["read the seed files"]
    R --> S["submodules — only an EMPTY one"]
    S --> D["docker compose --profile pubsub up -d --wait"]
    D --> E["pubsub ensure — the emulator's topics"]
    E --> M["migrate up-all"]
    M --> SM["supplier move"]
    SM --> SB["supplier backfill-figures"]
    SB --> SD["seed dev"]
    SD --> SC["seed categories"]
    SC --> RG["region load-seed"]
    RG --> N["npm install"]
    N --> OK["✓ next: dev run, log in as dev"]
```

**Local only, and it never asks.** It acts on the docker database (`POSTGRES_*` env, the same database
the prompt calls *Database Local*), which is the one the API uses by default. `seed dev` creates
superusers with a known password, so pointing it anywhere else has to be a deliberate act. When
`--dsn` or `DATABASE_URL` is set, setup **refuses** instead of guessing which database you meant. To
set up a different database, run the steps one by one against it.

**Re-running resets the fixture**, which is usually what you want:

- every dev account's password goes back to `--password`;
- a category you deleted or archived from the seeded tree is inserted again;
- rows you created yourself (teams, products, orders) are left alone;
- a warehouse fee is never reset: Dev Warehouse's, once written, is yours to change on its Settings screen.

**Only an EMPTY submodule is checked out.** `git submodule update` would also move an initialised one
back to the commit this repo records, under somebody who is working in it. Neither `san` nor the dev
servers import a submodule. Step 1 is for `go build ./...` and `go test ./...`, which do.

A re-run takes about 15 s on a warm machine. Most of it is the regions upsert, about 5 s. The **first** run
also pulls the emulator's image, about 1.1 GB.

### Errors you should expect

| Message | Cause |
| --- | --- |
| `dev setup acts only on the local docker database` | `--dsn` or `DATABASE_URL` is set. Unset it, or run the steps by hand |
| `the dev password must be at least 8 characters` | `--password` is too short |
| `docker compose up: exit status 1 — is Docker running?` | Docker Desktop is not running. Start it, or pass `--no-docker` |
| `the Pub/Sub emulator is not answering on localhost:8085 although docker started it` | The container is up but not serving. `docker compose logs pubsub` says why |
| `pubsub ensure: …` | The emulator refused a topic or subscription. Same causes as [`pubsub ensure`](#pubsub-ensure)'s errors |
| `connecting to Database Local: …` | Postgres is not up. Drop `--no-docker`, or start it |
| `migrating <service>: …` | A broken migration. The services before it are applied, so re-run once it is fixed |
| `npm install: … is Node installed?` | Node is not installed or not on `PATH` |

---

## `dev run`

The whole local stack in **one terminal**, replacing the two terminals in the getting-started steps.
Every line of output is prefixed with the process that wrote it.

```sh
go run ./tools/san dev run               # the containers and the emulator's topics, then the API and the UI
go run ./tools/san dev run --no-docker   # the containers are already up
```

```
→ docker compose --profile pubsub up -d --wait
→ pubsub ensure --project warehouse-dev --emulator
topics ensured
subscriptions ensured
→ api  go run ./cmd/app_development   (in backend)
→ ui   npm run dev   (in frontend)
ui  |   VITE v6.4.3  ready in 401 ms
ui  |   ➜  Local:   http://localhost:5174/
api | … listening on localhost:8080
```

| Flag | |
| --- | --- |
| `--no-docker` | Skip `docker compose up`, because the containers are already running. The topics are still made if the emulator answers; a missing emulator is a warning, not an error |

It is a **machine** command ([two shapes](#two-shapes-and-which-rules-apply)): it picks no database
and builds no Wire graph. Each server runs in the directory a person would `cd` into, so the API
still finds an optional `backend/config.yaml`.

### What it does

```mermaid
sequenceDiagram
    actor P as you
    participant S as san dev run
    participant D as docker compose
    participant E as the emulator
    participant A as api, go run
    participant U as ui, npm run dev
    P->>S: go run ./tools/san dev run
    S->>S: frontend/node_modules present?
    S->>D: --profile pubsub up -d --wait
    D-->>S: postgres, redis and the emulator healthy
    S->>E: pubsub ensure — on every start, it forgets them
    E-->>S: topics and subscriptions ensured
    par
        S->>A: start, in backend/
    and
        S->>U: start, in frontend/
    end
    alt Ctrl-C, or the terminal closes
        P->>S: Ctrl-C
        S->>A: kill the whole process tree
        S->>U: kill the whole process tree
        S-->>P: ✓ stopped, exit 0
    else one server exits on its own
        A-->>S: exited
        S->>U: kill the whole process tree
        S-->>P: api exited — stopped the rest, exit 1
    end
```

**It stops as one thing.** Half a stack is the confusing case: a UI whose API died a minute ago shows
every screen failing, and nothing on the screen says the server is gone. So any server that exits,
even with code 0, takes the other one down with it, and the error names the server that exited.

**It kills the tree, not the process.** `go run` is go.exe → the toolchain's go.exe → the built
server, and `npm run dev` is cmd.exe → npm → vite. Killing the outer process leaves the inner one
holding :8080 or :5174. Each server is started in its own process group and stopped as a group:
`kill(-pgid)` on Unix, `taskkill /T` on Windows. The code is
[`proctree`](../../tools/san/proctree/), shared with [`remote`](#remote). Having its own group also
means Ctrl-C reaches only `san`. On Windows that keeps cmd.exe from stopping at *"Terminate batch job
(Y/N)?"*.

The stop is a **hard kill**. The API does not drain its requests, which is fine for a dev server.

### The emulator and its topics

The dev server publishes to the Pub/Sub emulator
([dev-runs-the-emulator](../technical/event_architecture/context_decision.md#dev-runs-the-emulator)), and
without it a publish does not fail — it **waits about a minute**, so placing an order hangs on a form with
nothing wrong with it. So `dev run` and `dev setup` both:

| | why |
| --- | --- |
| turn on the compose `pubsub` profile | the emulator is behind it, so a plain `docker compose up` leaves it out |
| wait for it to be **healthy** | its healthcheck asks it to answer. Running is not enough: the JVM starts seconds before it serves |
| run [`pubsub ensure`](#pubsub-ensure) on **every** start | ⚠ the emulator keeps topics in MEMORY. A restarted container (Docker Desktop restarting is enough) has none, and a publish to a missing topic hangs the same way. Ensuring is idempotent and takes a second |

Under `--no-docker` it still makes the topics when the emulator answers, and only **warns** when it does not:
every screen but placing an order works without it.

### What it does NOT do

| | Do it yourself |
| --- | --- |
| Migrate, seed the logins, `npm install` | [`dev setup`](#dev-setup). `dev run` never changes the database you review on |
| Survive `kill -9` / `taskkill /F` of `san` itself | Cannot. The servers outlive it. Stop it with Ctrl-C |

### Errors you should expect

| Message | Cause |
| --- | --- |
| `docker compose up: exit status 1 — is Docker running?` | Docker Desktop is not running. Start it, or pass `--no-docker` |
| `the Pub/Sub emulator is not answering on localhost:8085 although docker started it` | The container is up but not serving. `docker compose logs pubsub` says why |
| `⚠ the Pub/Sub emulator is not answering …` | Not an error — `--no-docker` with no emulator. The stack starts. Start the emulator before placing an order |
| `frontend/node_modules is missing` | Run [`dev setup`](#dev-setup), or `cd frontend && npm install` |
| `api exited (exit status 1) — stopped the rest` | Read the `api \|` lines above it. `failed to connect … :5433` means Postgres is down. A bind error on :8080 means the stack is already running somewhere |
| `ui exited (exit status 1) — stopped the rest` | Read the `ui \|` lines. `Port 5174 is already in use` comes from vite's `strictPort` |
| `start ui: exec: "npm": executable file not found` | Node is not installed or not on `PATH` |

---

## `test measure`

**Measured testing** — the rule is
[the-full-e2e-waits-for-a-measured-yes](../development_lifecycle_decision.md#the-full-e2e-waits-for-a-measured-yes):
tests run cheap to expensive; the full suites (the full `go test ./...`, the full Storybook run, the full
e2e — about 25 minutes together on 3 parallel e2e workers, 45 as one) wait until a MEASUREMENT of the change says they are due, and then the
owner is asked in one line. The measurement compares FILES — never a commit, never git — with what the last
green full run tested, kept in `e2e_report/` at the repo root (gitignored).

```sh
go run ./tools/san test measure                  # the files now against the last green full run
go run ./tools/san test measure --ready          # about to report work ready: any change makes it due
go run ./tools/san test measure --end-of-day     # a due run still unanswered at the day's end is overdue
go run ./tools/san test measure --since "2026-11-13 15:38"   # no baseline yet: files modified after a time
```

| Flag | |
| --- | --- |
| `--ready` | Work is about to be reported ready — any change since the last green run makes the full run due |
| `--end-of-day` | The day is ending — a due full run still unanswered is **overdue** |
| `--since` | Only while there is no `last_green.json`: count the files modified after this time instead. `"2006-01-02 15:04"`, RFC 3339, or a file whose modification time is used (an old run's `summary.txt`) |

### What it reads

**The fingerprint** is every source file and a hash of its content (CRLF read as LF, so a checkout's
line endings are not a change): `backend/`, `proto/`, `tools/`, `frontend/src/`, `frontend/e2e/`,
`frontend/.storybook/`, the migrations (inside `backend/`), plus `go.mod`, `go.sum` and the frontend's
`package.json`, lock file and build/test configs. Skipped: `gen/` (regenerated from the `.proto` files,
which ARE fingerprinted), `node_modules`, `dist`, `bin`, `e2e_report`, test output, `*.exe`.

Each changed, added or deleted file goes into an **area** (a backend service — its `.proto` counts with
it —, a page, a feature, the shared components, the layout and menu, sign-in, the e2e setup …) and gets a
**risk**:

| Risk | What | Counts toward "3+ areas"? |
| --- | --- | --- |
| **wide** | the list below — due on its own | yes |
| normal | app code | yes |
| low | tests only: `*_test.go`, `*.stories.tsx`, `*.test.ts`, `.storybook/`, an e2e spec, `smoke.txt`/`affected.txt` | no |

**The wide-change list, as built** (the decision's list; a path heuristic, grown each time a full run
catches a break it rated low):

| The decision says | Built as |
| --- | --- |
| a shared component | `frontend/src/components/**` |
| the layout or the menu | `frontend/src/layouts/**` (`nav.ts` is the menu); the app shell every page renders through — `router.tsx`, `main.tsx`, `theme.ts`, `transport.ts`, `api/**` |
| sign-in or permissions (`request_policy`) | `user_service/access_interceptors/**`, `user_v1/{login,logout,check_access,role_resolve,team_access_list}.go`, `backend/pkgs/san_auth/**`, `proto/warehouse/role_base/**`, `frontend/src/features/auth/**`, `frontend/src/pages/login/**` — **and** any `.proto` whose request message's `request_policy` (or another `role_base` option) changed, read against the copy of the `.proto` files kept with the last green run |
| an existing field made required | a field present in the last green `.proto` that gains `required = true`, `gt`, `min_len ≥ 1`, `min_items ≥ 1`, `min_bytes ≥ 1` or `not_in`. Also a **new** field carrying one of them on a message that already existed — it breaks every caller the same way |
| a migration that alters an existing table | a migration whose Up half runs `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` or `CREATE UNIQUE INDEX` on a table the same file does not create; a migration the last green run had that now reads differently (an applied migration edited); a removed migration |
| an event's contents | in `proto/warehouse/events/**`, an existing event message with a field added, removed, or of another type or number (a new event — a new message and a new arm of `Event` — is not) |
| the e2e setup or helpers | `frontend/e2e/**` except the specs and the two lists, `frontend/playwright.config.ts`, and the `tools/san` files the e2e's global setup runs (`db.go`, `migrate.go`, `seed.go`, `region.go`, `pubsub.go`, `services.go`) |

**Not wide: a dependency bump.** `go.mod` / `go.sum` and the frontend's `package.json` / lock file count as one ordinary
area (normal risk), not a wide change — the owner's call
([a-dependency-bump-is-one-area](../development_lifecycle_decision.md#a-dependency-bump-is-one-area)).

### Due and overdue

| | When |
| --- | --- |
| **due** | there is no green baseline yet · or a wide change · or 3+ areas with a non-test change · or `--ready` and anything changed |
| **overdue** | due, and 5+ areas · or due since an earlier day (kept in `e2e_report/state.json`) · or `--end-of-day` |
| covered | no file differs from the last green full run |

When due it prints **one line** to put to the owner — what changed, why it is due, about how long (the last
full run's length, 25 min before any is recorded). It also rewrites `e2e_report/latest.md`.

```
measure — the files now against e2e_report/last_green.json (green 2026-11-13 18:40, run 20261113-175502)
  3214 source files fingerprinted (0c70d9235664)
  9 changed · 0 added · 0 deleted · 3 areas (+1 tests only)

  feature restock                normal  sideBySide.ts
  page restock-selling-detail    normal  ProductsPanel.tsx, index.tsx
  page restock-warehouse-detail  normal  LinesCard.tsx, index.tsx
  storybook                      low     pageStory.tsx, preview.tsx

DUE — 3 areas changed
ASK: full run due — 9 files in 3 areas (feature restock, page restock-selling-detail, page restock-warehouse-detail) changed since the last green run (13 Nov 18:40); why: 3 areas changed; about 25 min on a frozen copy, work goes on. Run it now?
```

With no `last_green.json` it says so and the full run is due: `no green baseline — a full run is due`.
Asking stops no work; work is never reported ready while the full run is due.

---

## `test affected`

The **level-2** e2e for a slice: the specs the change reaches, plus the smoke set.

```sh
go run ./tools/san test affected                       # the change since the last green full run
go run ./tools/san test affected --files a.go,b.tsx    # trace these files
go run ./tools/san test affected --run                 # …and run them here (affected specs whole + the smoke set)
go run ./tools/san test affected --run --dry-run       # print the Playwright batches only
```

| Flag | |
| --- | --- |
| `--files` | Trace these repo-relative files (comma-separated) instead of the measured change |
| `--since` | No green baseline yet: the files modified after a time (as for `measure`) |
| `--run` | Run the affected specs (whole) and the smoke set in this working tree, batched like the full run (`orders.spec.ts` alone; the restock family — `restock.spec.ts`, `restock_*.spec.ts` — together on its own when whole). Recorded in `e2e_report/level2/` |
| `--dry-run` | With `--run`: print the batches and run nothing |

**How it traces** — by reading the code, not a list someone keeps:

| A changed… | reaches |
| --- | --- |
| Go file in a service | the RPC handlers whose code reaches its functions and types (a name graph over the service's packages — a local variable or a field read named like a function does not count) → the specs naming the RPC (`"inventory.v1.RackService/RackCreate"`) and the pages calling it. No handler reached (a listener, `register.go`) → every RPC of the service |
| `backend/pkgs/x` | every service importing it, service-wide |
| `backend/cmd/…` | the services the file imports, service-wide |
| `.proto` | its RPCs; a `.proto` without services → its service |
| frontend file | the pages that import **what it exports**, by name (a hook module imported for another hook is not reached) → their routes in `router.tsx` → the specs visiting them (`page.goto`, `toHaveURL`), and the specs using its test ids (`getByTestId`, `[data-testid^=…]`, a literal passed to a helper). It does not climb past the app shell: a hook the sidebar happens to import would otherwise make every route affected — a change to the shell itself is wide, and the full run is due for it anyway |
| RPC called by the frontend | the hook or function making the call (`rackClient.rackList(…)` in `useRackList`) → the pages taking that name |
| e2e spec / helper | the spec itself / the specs importing the helper |
| story, Go test, story-only helper | no spec — listed as *tests only* |
| `tools/san` file outside the e2e setup | no spec — listed as *no e2e path runs these* |

**What reading cannot tell** is in `frontend/e2e/affected.txt`, a checked-in mapping:
`<glob> -> spec, spec   # why` (`*` within a folder, `**` across). It adds specs; a matching line also
stands in for the service-wide fallback. Today: the event contract and `event_source` (no RPC or page leads
to them — the specs that wait on a listener), and `i18n` (a spec finds buttons by their words). A file
nothing reaches is listed as *not traced*: the smoke set covers it, and a line may be added.

```
affected — 22 changed files (modified since 2026-11-13 15:38, no green baseline yet)

  3 affected specs:
    orders.spec.ts
        opens /inventories/restock/:requestId (page restock-selling-detail) ← sideBySide.ts, ProductsPanel.tsx, index.tsx
        opens /inventories/restock/:requestId (page restock-warehouse-detail) ← sideBySide.ts, LinesCard.tsx, index.tsx
        uses test id restock-detail-page ← index.tsx, index.tsx
    restock.spec.ts
        …
    the_received_count_is_corrected.spec.ts
        uses test id restock-detail-adjustment-… ← ProductsPanel.tsx
        uses test id restock-detail-received-… ← LinesCard.tsx

  tests only — run them where they live (go test, the story's vitest file): pageStory.tsx, preview.tsx, …

  the smoke set (frontend/e2e/smoke.txt):
    sign in
        auth.spec.ts › root logs in, lands in the app, and sees the root team
    …
```

---

## `test smoke`

The **smoke set**: about five key flows, kept under 5 minutes, run with the affected specs after every
slice. The flows are the decision's — sign in, place an order, accept a restock, a transfer, accept a
return — and the tests are a checked-in list of real test titles, `frontend/e2e/smoke.txt`:

| Flow | Tests (`smoke.txt`) |
| --- | --- |
| sign in | `auth.spec.ts` › root logs in, lands in the app, and sees the root team |
| place an order (and the Team Balance it posts) | `the_order_keeps_exact_figures.spec.ts` — its 3 tests: the setup, the form places the order, Team Balance posts the fee |
| accept a restock | `restock_warehouse_wants_to_accept.spec.ts` › warehouse:all wants to accept a restock › warehouse:owner accept restock (status: arrived · all received · new product · no COD · 1 supplier) |
| a transfer | `transfers.spec.ts` — the first 4: setup, the team opens it, A ships, B counts it in |
| accept a return | `the_return_goes_back_on_the_shelf.spec.ts` — the setup and the Accept |

11 tests, one Playwright run (`--grep` built from the titles); measured **1 min 23 s** wall-clock on
2026-11-13, server start and database reset included.

```sh
go run ./tools/san test smoke             # run it here; recorded in e2e_report/level2/<stamp>-smoke/
go run ./tools/san test smoke --dry-run   # the flows, the command, and a check that every line names one test
```

`smoke.txt`: one flow per `## ` heading; each line is `<spec file> › [<describe> › …] <test title>`,
the title as Playwright shows it. A serial spec's later test needs the earlier tests it builds on, so
those are listed too. `--dry-run` asks Playwright to `--list` the selection (no server starts) and fails
when a line matches no test or more than one — a renamed test cannot silently drop a flow.

```
→ b1 auth.spec.ts restock.spec.ts the_order_keeps_exact_figures.spec.ts the_return_goes_back_on_the_shelf.spec.ts transfers.spec.ts
[1/11] [chromium] › e2e\auth.spec.ts:58:1 › root logs in, lands in the app, and sees the root team
…
  11 passed (1.4m)

smoke 2026-11-13 17:05 · GREEN · 1m23s · e2e 11 passed · `level2/20261113-170553-smoke`
```

### How a level-2 run treats the ports and the database

The e2e has ONE test database and ONE pair of ports (API :8081, UI :5175), and its setup drops that
database, so two runs at once destroy each other ([e2e/lock.ts](../../frontend/e2e/lock.ts)). Before
anything starts, `smoke` and `affected --run`:

| | |
| --- | --- |
| refuse | while another Playwright run holds `frontend/.e2e-lock`, or a `--shared-db` full run is live (it uses the same database and ports). A full run on its own worker — the default — shares nothing with them and never stops them ([While it runs](#test-full)) |
| clean | a dead run's `.e2e-lock`, and THIS checkout's leftover servers on :8081/:5175 (`app_development`, or a vite started from this `frontend/`) — killed with their whole tree |
| never touch | another program on those ports (another project's dev server): it stops with `STOP: :5175 is held by pid …` |
| check | Docker is running and `warehouse_revamp_postgres` is healthy |

Playwright runs through `node …/@playwright/test/cli.js`, not `npx` — `npx.cmd` goes through cmd.exe,
which would read a `--grep`'s `|` as a pipe.

---

## `test full`

**Level 3**: the full `go test -count=1 ./...`, the full Storybook run and the full e2e — on a **frozen
copy** of the folder, so the files tested are exactly the files fingerprinted and work goes on in the real
folder while it runs. Run it when [`test measure`](#test-measure) says due **and the owner said yes**.

```sh
go run ./tools/san test full --dry-run     # the plan: the copy, every step, each worker's batches and the estimate
go run ./tools/san test full               # ~45 min (go, Storybook, then the e2e on ONE worker — the default); in the background — development goes on beside it
go run ./tools/san test full --workers 3   # faster (~27 min) but heavy on the CPU — only when the owner asks
go run ./tools/san test full --spec restock.spec.ts --skip go --skip stories   # a partial run — never moves last_green
```

| Flag | |
| --- | --- |
| `--dry-run` | Print the plan and run nothing |
| `--keep-copy` | Keep the frozen copy afterwards, to debug a failure in the files tested |
| `--copy-dir` | Where the copy goes. Default `<the checkout's parent>/.san_frozen/<name>-<stamp>/` — beside the checkout, on its volume |
| `--spec`, `--story`, `--go` | Only these e2e specs / story files (from `frontend/`) / go packages — a **partial** run |
| `--skip` | `go`, `stories` or `e2e` — partial |
| `--workers` | e2e workers, 1–6, default **1** ([the-full-e2e-runs-on-one-worker](../development_lifecycle_decision.md#the-full-e2e-runs-on-one-worker)). Every worker — the one too — has its own database, ports and events project ([below](#parallel-workers---workers-n)); `3` (~27 min) only when the owner asks |
| `--shared-db` | Hidden. The old e2e: the same batches on the live tree's `warehouse_test`, :8081/:5175 — it then blocks `smoke`, `affected --run` and Go DB tests in the live tree, as every full run did before 2026-11-14. Only to compare against a run on the worker |
| `--times` | An old `e2e_batches.sh` `summary.txt` (its `b<N>.log` files beside it) to read per-spec times from, for specs no recorded full run has timed yet — used for the balancing and the estimate |

A partial run is recorded like any other and **never moves `last_green.json`**.

```mermaid
sequenceDiagram
    actor P as you
    participant S as san test full
    participant R as e2e_report/
    participant C as the frozen copy
    participant G as go test
    participant V as vitest (Storybook)
    participant W as Playwright, per batch
    P->>S: go run ./tools/san test full
    S->>S: refuse if another full run is live (or a live-tree run as its worker, frontend/.e2e-lock.w1)
    S->>R: .full_run.lock, and the live frontend/.e2e-lock.w1 — never the live tree's own .e2e-lock
    S->>R: runs/<stamp>/fingerprint.json — the files tested
    S->>C: copy the checkout (no .git, no build output), node_modules hard-linked
    S->>G: go test -count=1 ./... in the copy, on its own warehouse_test_go (cap 30 min)
    S->>V: vitest run --project=storybook in the copy, on its own browser port 6116+ (cap 20 min)
    opt only LOAD failures (a-file-that-fails-to-load-is-re-run-once)
        S->>V: each load-failed story file once more, by itself, in the copy
    end
    S->>S: the template warehouse_test_tpl — db reset-test, migrate up-all, region load-seed, seed root
    par each worker (w1 alone by default, w1…w3 with --workers 3) — its own database, API and UI ports, events project
        loop its batches, name-ordered, up to 6 specs (orders alone, on one worker the restock family together)
            S->>S: stop that worker's own leftover servers on its two ports, check Docker and Postgres
            S->>W: the batch, in the copy — global-setup clones warehouse_test_wN from the template
            W-->>S: pass/fail and time per spec (JSON reporter), a failure's traces → runs/<stamp>/failures/wN-bM/
        end
    end
    opt a batch failed only because a spec failed to LOAD
        S->>W: that spec alone, then the batch's other specs, once each, in fresh batches on the same worker
    end
    S->>S: drop the template (each worker's teardown dropped its own database)
    Note over S,W: --shared-db instead: the same batches on the live tree's warehouse_test, :8081/:5175
    S->>R: the .proto files tested → runs/<stamp>/proto/
    S->>C: delete the copy
    alt go, Storybook and every batch green (a load failure counting by its re-run), and not partial
        S->>R: last_green.json ← this fingerprint, last_green_proto/ ← its .proto files
    end
    S->>R: run.json, summary.md, latest.md, then remove the locks
```

**The frozen copy** is everything a test reads minus what is built: no `.git`, `bin`, `dist`, test output,
`e2e_report`, `.env` or `*.exe`; generated code is kept. `frontend/node_modules` is **hard-linked** file by
file (about 33,000 files, copied instead if the copy is on another volume), so nothing is installed twice and
an `npm install` in the real folder mid-run does not reach the copy; Vite's and Vitest's caches (`.vite`,
`.vitest`, `.cache`) start empty in the copy, so a running dev server's cache is never rewritten. Not
junctions: a junctioned package resolves to its real path in the live folder, and Vite's `server.fs.allow`
refuses to serve it to the Storybook test browser — tried on 2026-11-13, the Storybook part failed. The copy
is deleted afterwards (`--keep-copy` keeps it); the delete refuses a folder without the copy's marker file or
holding any junction or symlink.

**While it runs, development goes on.** The run shares nothing with the live tree's own tests — even on ONE worker:

| | the full run (the copy) | the live tree's own tests |
| --- | --- | --- |
| go test | `warehouse_test_go` (`TEST_DATABASE_URL`; dropped before and after) | `warehouse_test` (`san_testdb`'s default) |
| Storybook (vitest browser) | port 6116, or the next free one up to 6155 (`STORIES_BROWSER_PORT`, read by `frontend/vitest.config.ts`) | 6106 |
| e2e database | `warehouse_test_w1`, a fresh clone of `warehouse_test_tpl` per batch | `warehouse_test` |
| e2e API / UI | :8181 / :5181 (the next free pair if another program holds one) | :8081 / :5175 |
| events (Pub/Sub emulator project) | `warehouse-e2e-w1` | `warehouse-e2e` |
| run lock, output, Vite cache, sign-ins | the copy's `frontend/.e2e-lock.w1`, `test-results/w1/`, `node_modules/.vite-e2e-w1`, `e2e/.auth/w1/` | `frontend/.e2e-lock`, `test-results/`, `node_modules/.vite`, `e2e/.auth/single/` |

So, meanwhile, the live tree may run **Go DB tests**, **`test smoke` / `affected --run`** and **Storybook** (a vitest
run, or `npm run storybook` on 6006) — the live tree's Go DB tests and its e2e still share `warehouse_test` with **each
other**, so those two go one after the other, as always. Proved 2026-11-14 with three partial full runs on
`warehouse_test_w1`, :8181/:5181 (all green): beside the first and second, the live tree's smoke passed on
`warehouse_test`, :8081/:5175 (`netstat` showed all four ports listening and Postgres held connections to both databases
at once); beside the third, the live tree's Go DB tests (product_service + expense_service, 164 passed, none skipped)
passed on `warehouse_test` while the worker's servers were up; and a Storybook-only partial on :6116 passed while a
live-tree vitest run held :6106.

What still refuses — only what truly collides:

| Started while a full run is live | |
| --- | --- |
| a second `test full` | refuses: two full runs share the template `warehouse_test_tpl`, the worker databases and their ports |
| a Playwright run in the live tree **as worker w1** (`E2E_WORKER=w1 …`) | refuses: the full run holds the live `frontend/.e2e-lock.w1` (the same `warehouse_test_w1`). Run such a repro as `w9` (`E2E_WORKER=w9 E2E_DB_NAME=warehouse_test_w9 E2E_API_PORT=8189 E2E_UI_PORT=5189 E2E_PUBSUB_PROJECT=warehouse-e2e-w9`) |
| `test accept-run` | refuses: the full run moves `last_green.json` when it ends; an older run accepted meanwhile could take it back |
| `test smoke`, `affected --run`, a plain `npx playwright test`, Go DB tests, Storybook | run — unless the full run was started with `--shared-db` (then they refuse, as before) |

The live tree's CPU is shared, of course: a Storybook or e2e run beside the full run slows both a little.

**Its programs are copied, not linked.** `frontend/node_modules` is hard-linked into the copy, except the five files a
process LOADS (`esbuild.exe`, rollup's and oxc's `.node` — ~18 MB): Windows refuses to delete any link of a loaded file,
so a Vite running in the live tree (its smoke, a dev server) pinned the copy's links and the copy could not be removed
(seen on the first run beside a live smoke).

**The batches** (one worker, the default — and `--shared-db`) are the old `e2e_batches.sh` ported: name-ordered, 6
specs each, `orders.spec.ts` alone and the **restock family** — `restock.spec.ts` and the four `restock_*.spec.ts` split
from it (backlog #51) — together in one batch of its own, as the one file was; each capped at 590 s (the restock batch at
1500 s — a cap hit is a timeout, not a failure: re-run that spec alone). On the worker each batch starts on a fresh clone
of the template, so the sort-order rules hold inside the batch exactly as on the old single database. Before each batch
it stops only its own leftover servers on its two ports, never another program's.

### A file that fails to load is re-run once

The rule is [a-file-that-fails-to-load-is-re-run-once](../development_lifecycle_decision.md#a-file-that-fails-to-load-is-re-run-once):
a story or spec **file** that never ran a check because it failed to load is re-run **once, by itself**, inside the same
full run, and green on the re-run counts as green; a failed check — an assertion, a timeout inside a test, a crash after
the file loaded — is **never** re-run; the same file failing to load again is red. The first full run on a frozen copy
(`runs/20261114-100420`) is why: 10 story files failed to load (all passed alone). It was first blamed on the copy's cold
Vite dependency cache; measured 2026-11-14 (`DEBUG=vite:deps`), the cold copy pre-bundles once at startup and never
re-bundles. The real cause was the test browser refusing requests — Chromium's `net::ERR_INSUFFICIENT_RESOURCES`, when
every story file's new iframe re-requested its whole module graph (~86,000 requests a run, 78,000 of them 304s); since
then `frontend/.storybook/runCachePlugin.ts` lets the browser cache modules for one `vitest run` (~8,000 requests).

Failures are sorted **per file**, conservatively — only these exact signatures make a load failure; anything else,
an unknown message, a failure no file can be named for, or a file with one load failure and one failed check, is red:

| Part | A load failure is | Read from |
| --- | --- | --- |
| Storybook | a FAIL'd **suite** (`FAIL \|storybook (chromium)\| <file> [ <file> ]`) whose error says `Failed to import test file` or `Failed to fetch dynamically imported module` | `stories.log` |
| Storybook | a FAIL'd **story** (`FAIL \|…\| <file> > <story>`) whose error is ONLY `Failed to fetch dynamically imported module: <url>` — beside the empty `TypeError:` header, the "Click to debug" link and stack frames. The import failed; no check ran | `stories.log` |
| Storybook | an **unhandled error** `Failed to run the test <file>.` caused by `Cannot connect to the iframe` | `stories.log` |
| e2e | Playwright (1.61) stops the WHOLE run when a spec fails to load: the batch's JSON report loaded no suite and counted no test, and every one of its top-level `errors` names a spec of the batch — by `location.file` (a SyntaxError, a throw while the file is evaluated) or by `Cannot find module '…' imported from <spec>`. An error in the global setup (its location is `global-setup.ts`), a web server that never started, a missing import in a helper — red | `w<K>-b<N>.json` |

The vitest counts must agree too: more failed files (`Test Files N failed`) or errors (`Errors N`) than the log names is
red — something went unread. And **every file it counted must have run**: `Test Files a failed | b passed | c skipped (T)`
with a + b + c < T is red, nothing re-run. Vitest's browser pool stops the whole run at the first file that errors (an
iframe that never loaded, a dropped browser), and the files still queued are in the total but in no count — re-running
the load-failed ones would leave those untested and call the run green. `runs/20261114-100420` (accepted) and
`-131538` (its Storybook part counted green) left 29 and 32 files unrun; `accept-run` now refuses such a run.

| | Storybook | e2e |
| --- | --- | --- |
| re-run | each load-failed file by itself: `vitest run --project=storybook <file>` in the copy (cap 10 min), after the full Storybook run | each load-failed spec alone, then the batch's other specs (they never ran) together — fresh batches on the same worker's database, ports and events project, before the template is dropped (`--shared-db`: on `warehouse_test`) |
| only when | every Storybook failure is a load failure — a failed check makes the part red, nothing is re-run | no e2e batch failed a test or hit its cap |
| green | the re-run ran tests and none failed | the fresh batch passed with tests run |
| logs | `stories-rerun-<n>.log` | `w<K>-rerun<n>.log` / `.json` |

The run record names every file re-run, why (the signature matched) and its result: `reruns` in `run.json`, a
*Re-run once* table in `summary.md`, the failures per file (load / check) under the Storybook section, and a *re-run
after a load failure N/M green* note in the run's one-line verdict. A run that ended before this was built — or one
whose load failures could not be re-run — is made the baseline with [`test accept-run`](#test-accept-run).

### Parallel workers (`--workers N`)

**The default is ONE worker** — the name-ordered batches above, one after another, ~33–35 min — the owner's call, so the
machine's CPU is not heavy ([the-full-e2e-runs-on-one-worker](../development_lifecycle_decision.md#the-full-e2e-runs-on-one-worker)).
It is a worker like any other: `w1` below, its own database, ports and events project, so it never meets the live
tree's runs. With `--workers N` (N > 1, on request) it runs as N
whole Playwright runs **at once** from the frozen copy, and each worker has its own of everything a run touches — so
no worker can see, reset or be pushed another's data ([frontend/playwright.config.ts](../../frontend/playwright.config.ts),
[frontend/e2e/env.ts](../../frontend/e2e/env.ts)):

| | w1 | w2 | w3 | how |
| --- | --- | --- | --- | --- |
| database | `warehouse_test_w1` | `warehouse_test_w2` | `warehouse_test_w3` | each batch's global-setup **clones** `warehouse_test_tpl` (`db reset-test --template`, ~1 s); the worker's teardown drops it |
| API port | 8181 | 8182 | 8183 | `E2E_API_PORT` — the backend's `ADDR`, `INTERNAL_BASE_URL`, `DOCUMENT_BASE_URL`; specs call `API_URL` |
| UI port | 5181 | 5182 | 5183 | `E2E_UI_PORT` — Vite, `ALLOWED_ORIGINS`, Playwright's `baseURL` |
| events | `warehouse-e2e-w1` | `warehouse-e2e-w2` | `warehouse-e2e-w3` | `E2E_PUBSUB_PROJECT` — the emulator project; `pubsub ensure` points its push subscriptions at the worker's own API port |
| the rest | | | | its run lock `frontend/.e2e-lock.wN`, output `test-results/wN/`, Vite cache `node_modules/.vite-e2e-wN`, saved sign-ins `e2e/.auth/wN/` |

A port another program holds is **skipped** for the next free pair (8184/5184, …) and named in the plan — never
killed; 8080/8081/5174/5175 are never used. The dev servers and the dev database are not touched.

**The template.** `warehouse_test_tpl` is made once per run with the steps `e2e/global-setup.ts` takes — `db
reset-test`, `migrate up-all` (the same service order), `region load-seed` of `e2e/fixtures/regions.csv`, `seed root`
with the password read from `global-setup.ts` — about 15 s; then every batch of every worker clones it instead of
migrating. It is dropped at the end.

**Sharing out** (N > 1). The specs are placed **longest first**, each on the worker with the least work so far (LPT), by the
per-spec times the newest recorded full runs hold (`e2e_report/runs/*/run.json`), else an old `summary.txt`
(`--times`, each batch's time shared by the tests its `b<N>.log` ran), else the per-test rate of the spec a file was
split from (`restock_x.spec.ts` ← `restock.spec.ts`), else 6.5 s a test (Playwright `--list` counts them). Inside a
worker the specs run in **name order**, in batches of up to 6 (orders alone), each batch on a fresh clone — so every
"named to sort after `orders.spec.ts`" rule still holds where two such specs meet.

**Coupled specs.** Specs that must share one database — one READS what an earlier one wrote — are listed in
[frontend/e2e/coupled.txt](../../frontend/e2e/coupled.txt), one group per line, and travel as one unit (same worker,
same batch, name order). None today: every spec seeds its own ground; the couplings found (polluters that must sort
after `orders.spec.ts`/`statement.spec.ts`; `settlement_imports.spec.ts` before `the_closed_shop.spec.ts`, which
import the same fixture) are of the sort-after kind, which name order keeps and separate databases cannot break.

**Sign in once per role.** Each batch's setup signs root in once through the real Login RPC and saves it as a
Playwright storageState (`e2e/.auth/<worker>/root.json`); a test's first sign-in as root loads it instead of typing
the form ([frontend/e2e/session.ts](../../frontend/e2e/session.ts)). `auth`, `profile` and `users` still type it —
signing in is what they test — and so does any second sign-in inside a test.

**Why 3.** Measured on this machine on 2026-11-14 (31.8 GB RAM, i7-11700F 8 cores / 16 threads): 19.1 GB free
idle, 14.2 GB at the 3-worker peak — a worker (Go API, Vite, Playwright, Chromium) takes about 1.6 GB. Memory
would carry more; 3 is the decision's "2–3 to start", and each extra worker adds a server start per batch and CPU
contention for every spec.

**What it records** — `e2e_report/runs/<stamp>/`:

| File | |
| --- | --- |
| `run.json` | everything below, machine-readable |
| `summary.md` | the verdict; go and Storybook with their failures; one row per batch (exit, time, counts); **pass/fail and time per spec**; the failures |
| `fingerprint.json` | the fingerprint tested (its 12-character sum is in the summary) |
| — | the areas changed since the previous run, and the slices logged since it ([`test slice`](#test-report--test-slice)) |
| `go.log`, `stories.log`, `b<N>.log`, `b<N>.json` | the logs, and Playwright's JSON report per batch (`b<N>` only for `--shared-db`); the go and Storybook sections of `summary.md` say where each ran (*Ran on database warehouse_test_go* / *vitest browser port :6116*) |
| `failures/b<N>/` | a failing batch's traces, screenshots and videos (Playwright clears them at its next run); a worker's are `failures/w<K>-b<N>/` |
| `w<K>-b<N>.log`, `w<K>-b<N>.json`, `template-<n>.log` | each worker's batch logs (`w1-b<N>` on one worker), and the template's four steps |
| — | the workers (database, ports, events project, batches, time) — a table in `summary.md`, `workers` in `run.json` |
| `proto/` | the `.proto` files tested — become `last_green_proto/` when green |
| `stories-rerun-<n>.log`, `w<K>-rerun<n>.log` | a load-failed file's one re-run ([above](#a-file-that-fails-to-load-is-re-run-once)); `reruns` in `run.json` and a table in `summary.md` say which, why, and how each went |
| `accept-<stamp>/` | the logs of a later [`test accept-run`](#test-accept-run); `acceptances` in `run.json` |

The plan on one worker (`go run ./tools/san test full --dry-run`, 2026-11-14):

```
(dry run: nothing is copied or run)
full run — the plan

  fingerprint  3274 source files (99d9d592a36b) — 107 changed since the last green run
  copy         D:\pdcgo\warehouse_revamp → D:\pdcgo\.san_frozen\warehouse_revamp-20261114-152958
               without .git, build output, e2e_report; generated code kept;
               frontend/node_modules hard-linked file by file (its .vite/.vitest/.cache the copy's own, empty)
  locks        e2e_report/.full_run.lock (a second full run refuses), and the live frontend/.e2e-lock.w1 (a live-tree run as that worker refuses)
  meanwhile    the live tree's Go DB tests and smoke / affected --run (warehouse_test, :8081/:5175 — still one of those at a time) and its Storybook (:6106) share nothing with this run and may go on
  1 go         go test -count=1 ./...   (in the copy, on its own database warehouse_test_go — not warehouse_test; cap 30m0s)
  2 stories    node node_modules\vitest\vitest.mjs run --project=storybook   (in the copy's frontend, vitest browser port :6116 — not the live tree's :6106; cap 20m0s)
  3 e2e        52 specs on ONE worker
               ONE worker with its OWN database (a clone of warehouse_test_tpl), API and UI ports and events project — nothing the live tree's runs use (warehouse_test, :8081/:5175);
               name order, batches of up to 6 specs, orders.spec.ts alone, the restock family (restock*.spec.ts) together; each on a fresh clone, cap 9m50s (restock 25m0s)
       tpl  warehouse_test_tpl — migrated + seeded once (db reset-test, migrate up-all, region load-seed, seed root), about 20s
       w1  db warehouse_test_w1 · API :8181 · UI :5181 · events warehouse-e2e-w1 · 52 specs in 11 batches · about 43 min
           b1  auth.spec.ts (20s) bundles.spec.ts (20s) expenses.spec.ts (26s) finance_metrics.spec.ts (15s) financial_accounts.spec.ts (58s) found_requests.spec.ts (41s)
           b2  inventory.spec.ts (4s) language.spec.ts (5s) liability.spec.ts (28s) opname_sessions.spec.ts (31s) order_drafts.spec.ts (29s)
           b3  orders.spec.ts (331s)
           b4  products.spec.ts (34s) profile.spec.ts (8s) racks.spec.ts (15s)
           b5  restock.spec.ts (51s) restock_selling_wants_to_edit.spec.ts (305s) restock_selling_wants_to_raise.spec.ts (190s) restock_warehouse_wants_to_accept.spec.ts (332s) restock_warehouse_wants_to_receive.spec.ts (33s)
           …   (b6–b10: six specs each, name order)
           b11  warehouses.spec.ts (17s) writes_need_a_shop_grant.spec.ts (10s)
       coupled      none listed (frontend/e2e/coupled.txt) — every spec is placed on its own
       e2e wall     about 44 min on one worker (the template, then its batches one after another)
       times        1 from its test count, 51 from a recorded full run
               before each batch: stop that worker's own leftover servers on its two ports (never another program's), check Docker and Postgres; afterwards the template is dropped
  load retry   a story or spec file that only failed to LOAD is re-run once, by itself, in the copy; a failed check never is (a-file-that-fails-to-load-is-re-run-once)
  record       e2e_report/runs/<stamp>/ (run.json, summary.md, fingerprint.json, logs, failures/), latest.md
  last green   e2e_report/last_green.json moves only when go, Storybook and every e2e batch are green
  estimate     about 50 min
```

### Errors you should expect

| Message | Cause |
| --- | --- |
| `a full run is live (pid …) — two full runs at once share the template …` | Another `test full` holds `e2e_report/.full_run.lock`. Wait — `test report` shows it. (`smoke`, `affected --run` and Go DB tests are NOT refused by it) |
| `a Playwright run in this folder runs as worker w1 (frontend/.e2e-lock.w1, …)` | A live-tree repro running as worker `w1` — the full run's database. Wait for it, or run the repro as `w9` |
| `another e2e run is live (frontend/.e2e-lock, pid …)` | Only with `--shared-db`: a Playwright run in this folder on `warehouse_test`. Wait for it |
| `no free port for the copy's Storybook run in 6116–6155` | Other programs hold every candidate — stop some |
| `--shared-db runs the e2e on the one warehouse_test — it takes no --workers N` | `--shared-db` is the single-database run; drop one of the two |
| `STOP: :5175 is held by pid … (…)` | Another program holds an e2e port. It is never killed: stop it, or run Playwright with a temporary config on a free port |
| `STOP: Docker is not running` / `warehouse_revamp_postgres is not healthy` | Start Docker Desktop, wait for Postgres, `go run ./tools/san dev setup --no-docker` |
| `the copy folder … already exists` | A `--copy-dir` in use. Pick another, or remove it |
| `frontend/node_modules is missing` | `go run ./tools/san dev setup` (or `npm install`) first |
| `the full run is not green — e2e_report/runs/<stamp>/summary.md` | Exit 1. Read the summary; `last_green.json` did not move |
| `--workers N: want 1 to 6` | Pick 1 (the default, the owner's) to 6; 3 is the measured most |
| `no free port pair for N workers in 8181–8220 / 5181–5220` | Other programs hold every candidate pair — stop some, or run fewer workers |
| `the template step "migrate up-all" failed` / `cloning … from the template …` | The template could not be made or copied — `runs/<stamp>/template-<n>.log`; a clone fails while anything is connected to `warehouse_test_tpl` |
| `smoke.txt names tests Playwright does not list exactly once` | A smoke test was renamed or moved — fix `frontend/e2e/smoke.txt` |

---

## `test accept-run`

Makes an **ended** full run the green baseline when its only failures were **load** failures
([a-file-that-fails-to-load-is-re-run-once](../development_lifecycle_decision.md#a-file-that-fails-to-load-is-re-run-once))
— a run that ended before the in-run re-run was built (the first one, `20261114-100420`), or one whose load failures
could not be re-run then.

```sh
go run ./tools/san test accept-run 20261114-100420 --dry-run    # check the run, list what would be re-run
go run ./tools/san test accept-run 20261114-100420              # re-run them now; on all green, move last_green.json
go run ./tools/san test accept-run 20261114-100420 --rerun src/pages/product-discover/stories/Search.stories.tsx \
    --reason "<the owner's words making this run the baseline>"
```

| Flag | |
| --- | --- |
| `--rerun <file>` (alias `--rerun-passed`) | Also re-run this **Storybook** file (from `frontend/`) although its failure is a CHECK failure — **only on the owner's word** that this run is the baseline. Repeatable; only a file that failed in the run; needs `--reason`. An e2e test that failed is never accepted |
| `--reason` | Why the `--rerun` files may be re-run — recorded in `run.json`, `summary.md` and `latest.md` |
| `--dry-run` | Check the run and print what would be re-run; re-run nothing, move nothing |

**What it checks — it refuses, changing nothing, when any fails:** the run is a whole `full` run (not partial, not
stopped, not already green, not already accepted, no earlier red acceptance — a file is re-run once, a second failure is
red); `go test` green; the e2e has **0 failed tests**, and a red batch is one that failed only to load (the e2e
signature [above](#a-file-that-fails-to-load-is-re-run-once), read from its JSON report); every Storybook failure in
`stories.log` is a load failure by the same classifier — or a file named with `--rerun` and `--reason`; none
unattributed; no in-run re-run red.

**What it does:** re-runs each of those files **once, by itself, now, in the live tree** — a story file with `vitest run
--project=storybook <file>`, a load-failed e2e batch as its load-failed spec alone and then its other specs, on :8081/:5175
like a level-2 run (it refuses while any full run is live — that run moves `last_green.json` when it ends — or
another e2e run holds `frontend/.e2e-lock`). When every re-run is green, it moves
`e2e_report/last_green.json` to **that run's** fingerprint (`runs/<stamp>/fingerprint.json` — never today's tree; the
files changed since then stay *changed since the last green run*) and its `.proto` files to `last_green_proto/`. It
records the acceptance — every file, why (`load`, `never-ran`, or `named` with the reason), its result, and whether the
file still reads as the run tested it — as `acceptances` in `run.json`, an *Accepted* section in `summary.md` (the run's
verdict then reads `GREEN (accepted …)`), and a line under *The last green full run* in `latest.md`. A red re-run is
recorded too (*Not accepted*) and moves nothing; logs in `runs/<stamp>/accept-<stamp>/`.

The first run, accepted for real on 2026-11-14 (`--rerun` for the Search story: a 15 s timeout is a CHECK failure by
the rule — its log does not tie it to the re-bundle — re-run only because the owner made this run the first baseline;
long lines cut here with …):

```
accept-run 20261114-100420 — full 2026-11-14 10:04 · RED · 23m24s · go ✓ 47 passed · stories ✗ 4 failed (exit 1) · e2e 312 passed, 2 skipped · `runs/…
  fingerprint  8dcc80678c5c (3239 files) — what last_green.json would become
  go           ✓ 47 passed
  e2e          312 passed, 2 skipped
  stories      ✗ 4 failed (exit 1) — per file: 10 failed to load, 1 failed a check
    load   src/components/badges/SettlementSourceBadge.stories.tsx — Failed to import test file (SettlementSourceBadge.stories.tsx) — Failed to fetch…
    load   src/components/chrome/ColorModeToggle.stories.tsx — Failed to import test file (setup-file-with-project-annotations.js) — Failed to fetch …
    load   src/components/chrome/Logo.stories.tsx — Failed to import test file (setup-file-with-project-annotations.js) — Failed to fetch dynamically…
    load   src/pages/restock-form/index.stories.tsx — Failed to import test file (setup-file-with-project-annotations.js) — Failed to fetch dynamical…
    load   src/pages/supplier-discover-detail/index.stories.tsx — Failed to import test file (setup-file-with-project-annotations.js) — Failed to fet…
    load   src/components/chrome/StatsToggle.stories.tsx — Failed to import test file (StatsToggle.stories.tsx) — Failed to fetch dynamically importe…
    load   src/pages/products/index.stories.tsx — Failed to import test file (setup-file.js) — Failed to fetch dynamically imported module (setup-fil…
    load   src/features/orders/form/WarehouseBand.stories.tsx — Failed to import test file (WarehouseBand.stories.tsx) — Failed to fetch dynamically …
    load   src/components/feedback/EmptyHint.stories.tsx — Failed to fetch dynamically imported module (@storybook_react-dom-shim.js) — the story's o…
    load   src/pages/supplier-discover/index.stories.tsx — unhandled: Failed to run the test — Cannot connect to the iframe
    named  src/pages/product-discover/stories/Search.stories.tsx — named with --rerun: the owner made run 20261114-100420 the first green baseline (d…
  re-run       11 files, each ONCE by itself, now, in the live tree (D:\pdcgo\warehouse_revamp\frontend)

→ re-running in the live tree (fingerprint now 5f1d4786ce5b; the run tested 8dcc80678c5c)
  ✓ 3 passed src/components/badges/SettlementSourceBadge.stories.tsx
  ✓ 3 passed src/components/chrome/ColorModeToggle.stories.tsx
  ✓ 5 passed src/components/chrome/Logo.stories.tsx
  ✓ 2 passed src/pages/restock-form/index.stories.tsx
  ✓ 2 passed src/pages/supplier-discover-detail/index.stories.tsx
  ✓ 5 passed src/components/chrome/StatsToggle.stories.tsx
  ✓ 2 passed src/pages/products/index.stories.tsx
  ✓ 3 passed src/features/orders/form/WarehouseBand.stories.tsx
  ✓ 3 passed src/components/feedback/EmptyHint.stories.tsx
  ✓ 2 passed src/pages/supplier-discover/index.stories.tsx
  ✓ 4 passed src/pages/product-discover/stories/Search.stories.tsx

**Accepted** 2026-11-14 11:10 by `san test accept-run`: 11 files re-run once each in the live tree, all green — 10 load failures, 1 named with --reru…
```

Then `test measure` compares with that run: only the files changed since it (`8dcc80678c5c`) count.

---

## `test report` · `test slice`

```sh
go run ./tools/san test report                 # latest.md, then the recent full and level-2 runs
go run ./tools/san test slice "restock layout pass"   # log the files changed since the last mark
```

`report` prints `e2e_report/latest.md` — the last full result, the last green one, **whether today's files
are covered**, the due/overdue line, the last smoke/affected run — and one line per recent run (`--runs`,
default 5).

`slice` appends to `e2e_report/slice_log.md` the files changed since the previous mark (or the last green
run), under the time and the name given, and keeps the fingerprint as the next mark. A full run's summary
lists the slices logged since the previous run, so a failure is traced to the slice that changed its files —
without git.

### `e2e_report/`

At the repo root, gitignored — nothing in it is committed:

| | |
| --- | --- |
| `latest.md` | the last result, and whether today's files are covered (rewritten by every `test` command that measures) |
| `last_green.json` | the fingerprint the last all-green, non-partial full run tested — or the run a [`test accept-run`](#test-accept-run) accepted |
| `last_green_proto/` | that run's `.proto` files — what `measure` diffs a `.proto` against |
| `runs/<stamp>/` | one full run (above); `accept-<stamp>/` inside it — a [`test accept-run`](#test-accept-run)'s logs |
| `level2/<stamp>-smoke/`, `level2/<stamp>-affected/` | one smoke or affected run: `run.json`, `summary.md`, the logs |
| `slice_log.md`, `slice_mark.json` | the slice log and its last mark |
| `state.json` | since when the full run has been due (the overdue rule) |
| `.full_run.lock` | a live full run |

---

## `supplier move`

Copies every supplier and store out of inventory_service and into supplier_service, **keeping each id** — restocks
and batches hold those ids ([existing-suppliers-move-with-their-ids](../business/supplier/context_decision.md#existing-suppliers-move-with-their-ids)).
One-shot, and safe to run again: a row already moved is skipped — also when it was edited in supplier_service
since, which the run names and never overwrites. [`dev setup`](#dev-setup) runs it after migrating.

```sh
go run ./tools/san supplier move                     # prompts: Local or Production
go run ./tools/san supplier move --dsn "$DATABASE_URL"
```

| Flag | |
| --- | --- |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

⚠ **Run it right after `migrate up-all`, before anyone creates a supplier.** A supplier created first takes its
id from supplier_service's new sequence, and that id may be one a legacy row still needs. The move then refuses —
see the errors below — rather than overwrite or skip.

⚠ **A hand-written INSERT, against [HARD RULE 3b](../../CLAUDE.md)'s default.** A command normally calls the RPC
handler; no handler can create a row under a chosen id, and keeping the ids is the whole point. It copies rows that
already passed their own rules — it is not an operation on the domain.

### What it does

```mermaid
sequenceDiagram
  participant SAN as san supplier move
  participant L as legacy_suppliers, legacy_supplier_channels
  participant S as suppliers, supplier_channels
  SAN->>L: read every row — deleted ones too
  Note over SAN: fold — city and province into the address, an offline store into its supplier, code dropped
  SAN->>S: read what already sits under the moving ids
  alt an UNRELATED row under a moving id
    SAN-->>SAN: refuse, the clash named — nothing written
  else
    Note over SAN: a row moved before is skipped — named when edited since
    SAN->>S: INSERT each row not there yet, its id kept
    SAN->>S: set both id sequences past the largest id
  end
  Note over SAN,S: one transaction
```

| legacy | becomes |
| --- | --- |
| `address`, `city`, `province` | one `address`, joined with ", " ([no-province-or-city](../business/supplier/context_decision.md#no-province-or-city)) |
| `deleted = true` | `deleted_at` = the row's `updated_at` — the flag had no time ([a-deleted-supplier-is-kept-for-its-figures](../business/supplier/context_decision.md#a-deleted-supplier-is-kept-for-its-figures)) |
| `code` | dropped ([the-supplier-has-no-code](../business/supplier/context_decision.md#the-supplier-has-no-code)) |
| an **online** store | a store: marketplace → `channel_type` (`other` when it had none), `url` → `uri`, its contact and location kept in `description` |
| an **offline** store | folded into its supplier: contact and location fill the supplier's when empty, else are appended to its description ([the-supplier-lists-only-its-online-stores](../business/supplier/context_decision.md#the-supplier-lists-only-its-online-stores)) |

A row is "already there" — moved by an earlier run — when the same id holds a row of the same **origin**: the
same team (a store: the same supplier) and the same `created_at`. The move copies `created_at` and no edit changes
it or the team, so a supplier renamed or given a new contact since it moved is still the row it moved: skipped, kept
as it is, and named in the output. Any other row under a moving id — even one with the same team and name — was
created in supplier_service, not moved, and refuses the run.

### Output

```
[Database Local] suppliers: 14 moved (2 of them deleted), 0 already there
[Database Local] stores: 21 moved, 0 already there, 3 offline folded into their supplier
```

A re-run after edits in supplier_service:

```
[Database Local] suppliers: 0 moved (0 of them deleted), 14 already there
[Database Local] stores: 0 moved, 21 already there, 0 offline folded into their supplier
[Database Local] store 3 moved before and edited since (legacy "asdasd", now "Sumber Official") — kept as it is
[Database Local] supplier 7 moved before and edited since (legacy "Sumber", now "PT Sumber Makmur") — kept as it is
```

### Errors you should expect

| Error | Cause |
| --- | --- |
| `read legacy_suppliers (has inventory_service migrated to 00023?)` | The database is behind. Run [`migrate up-all`](#migrate) first |
| `supplier_service already holds a different row under a moving id — nothing was written: supplier 7 (legacy "Sumber" of team 12 created 2026-07-16 13:59, now "…" of team 89 created 2026-10-12 18:03)` | A supplier (or store) was created in supplier_service before the move ran, under an id a legacy row needs — its team or creation time is not the legacy row's, so it is not an earlier move edited since. Nothing was moved. The clashing row has to be re-numbered or removed by hand — decide which with the owner |

---

## `supplier backfill-figures`

Folds every restock accepted before *Restock Accepted* existed into the supplier figures, through supplier_service's
own fold ([past-accepts-are-backfilled-once](../business/supplier/context_decision.md#past-accepts-are-backfilled-once)).
**Once**: a second run folds nothing and says so. [`dev setup`](#dev-setup) runs it after the supplier move.

```sh
go run ./tools/san supplier backfill-figures                     # prompts: Local or Production
go run ./tools/san supplier backfill-figures --dsn "$DATABASE_URL"
```

| Flag | |
| --- | --- |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

It calls the fold, never a hand-written INSERT ([HARD RULE 3b](../../CLAUDE.md)), with the event the accept itself builds
(`inventory_v1.RestockAcceptedEvent`) — so a backfilled restock is folded exactly as a live one would have been.

### What it does

```mermaid
sequenceDiagram
  participant SAN as san supplier backfill-figures
  participant INV as restocks, their lines and problem rows
  participant SUP as supplier_service fold
  SAN->>SUP: figures_backfilled set? then stop — already backfilled
  SAN->>SUP: read figures_live_since — the earliest accept the webhook folded
  loop 500 accepted restocks naming a supplier at a time, oldest first
    SAN->>INV: the restocks, their lines, their problem rows
    SAN->>SUP: fold each — skipped when accepted at or after figures_live_since, or already claimed
  end
  SAN->>SUP: set figures_backfilled
```

| guard | stops |
| --- | --- |
| `figures_live_since` | folding a restock the broker carried — the live fold's dedup rows are pruned after 45 days, this key is not |
| the dedup claim, `restock-accepted:<id>` | folding one restock twice, live and backfilled, in the days they overlap |
| `figures_backfilled` | a second run. Written LAST, so a run that failed half way is simply run again |

⚠ **A replay cannot rebuild the backfilled past** — those accepts were never on the broker. `AnalyticReplayCompute`
therefore refuses any start on or before the live fold's first day.

### Output

```
[Database Local] supplier figures: 312 accepted restocks folded, 0 skipped (already folded, or the live fold's)
[Database Local] supplier figures: already backfilled — nothing folded
```

### Errors you should expect

| Error | Cause |
| --- | --- |
| `supplier: event processing is locked (process_event_lock)` | A replay is running — the fold refuses while it holds the lock. Run the backfill after it finishes |
| `relation "supplier_product_daily_reports" does not exist` | The database is behind. Run [`migrate up-all`](#migrate) first |

---

## `product recompose-codes`

Puts each team's code in front of the product codes written before a code was **composed on write**
([the-field-is-product-code-composed-on-write](../business/product/context_decision.md#the-field-is-product-code-composed-on-write)):
`SHOE-42` of team `ABC` becomes `ABC-SHOE-42`. Archived products too — they keep their code. **Safe to re-run**: a code
that already begins with its team's code and a dash is left alone. [`dev setup`](#dev-setup) runs it after the supplier
steps.

```sh
go run ./tools/san product recompose-codes                      # prompts: Local or Production
go run ./tools/san product recompose-codes --dsn "$DATABASE_URL"
```

| Flag | |
| --- | --- |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

The team codes are read through **team_service's `TeamByIds` handler**, validated as the interceptor would — never its
table, and no migration could have done it (HARD RULE 3). The write is product_service's own
`product_v1.RecomposeProductCodes`, so the composition (`<team_code>-<part>`) is the one ProductCreate uses.

### What it does

```mermaid
sequenceDiagram
  participant SAN as san product recompose-codes
  participant PROD as product_service — RecomposeProductCodes
  participant TEAM as team_service — TeamByIds handler
  SAN->>PROD: run, in ONE transaction
  PROD->>PROD: every product, locked, oldest first
  PROD->>TEAM: the owning teams' codes, 200 ids a call
  TEAM-->>PROD: id to team_code — a deleted or unknown team is omitted
  PROD->>PROD: per row — no team code, leave it and name it, already prefixed, leave it, else compose
  PROD->>PROD: a code two rows would share, refuse the whole run and name both
  PROD->>PROD: park each changed row on a placeholder unique by id, then set its composed code
  PROD-->>SAN: recomposed, already composed, left without a team code
```

| guard | stops |
| --- | --- |
| `<team_code>-` prefix check | a second run prefixing twice (`ABC-ABC-SHOE-42`) |
| the collision check, before any write | two products ending up on one code — the run is refused with both named, nothing written |
| the placeholder step | two rows trading codes tripping the unique index half way through |

⚠ **Order, restock and transfer lines keep the code they were written under** — they are snapshots, and the command
does not touch them. ⚠ A code a person typed with the team's prefix already, before composition existed, reads as
composed and is left as it is — it is exactly the string composition would have produced.

### Output

```
[Database Local] product codes: 12 recomposed, 0 already composed
[Database Local] product codes: 1 left as they were — their team has no code: products [57]
```

### Errors you should expect

| Error | Cause |
| --- | --- |
| `two products would carry one code: product 9 would become "ABC-SHOE-42", which product 4 already carries …` | Two of today's rows compose to one code. Rename one in the product form, then run it again |
| `column "product_code" does not exist` | The database is behind. Run [`migrate up-all`](#migrate) first — product `00008` renames the column |

---

## `shop grant-current-cs`

The rollout of [a-write-needs-a-grant-or-a-manager](../business/shop/context_decision.md#a-write-needs-a-grant-or-a-manager):
*"in the release that turns the gate on, every current CS is granted every shop of their team — nobody loses order-taking
on day one, and the owner trims afterwards."* **Run it in the release that ships the gate** (`selling_v1/shop_write_gate.go`)
— dry first, then for real. **Safe to re-run**: a grant that exists is skipped, so a second run adds nothing.

```sh
go run ./tools/san shop grant-current-cs --dry-run                  # prompts: Local or Production — writes nothing
go run ./tools/san shop grant-current-cs                            # the real run
go run ./tools/san shop grant-current-cs --dsn "$DATABASE_URL" --dry-run
```

| Flag | |
| --- | --- |
| `--dry-run` | Walk everything and print each grant it **would** add, and the summary — write nothing |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

| who | gets |
| --- | --- |
| a **current CS** — role `SELLING_CS` in a live selling team, not suspended, not erased | every live shop of that team they do not hold yet |
| the team's owner and admin | nothing — they write on every shop without a grant |
| a suspended or erased CS | nothing — the grant picker never offers them (a-suspended-user-is-never-picked) |
| a closed shop (`status = closed`, since selling `00043`) · another team's shop · a deleted team | nothing |

Every read and the write go through the **owning service's handler**, validated first as the interceptor would — team_service
`TeamList` (live selling teams), user_service `UserList` (members, `exclude_suspended`, with their role), selling_service
`ShopList` (open shops — `status` OPEN, each with its primary) and `ShopUserList` (who already holds it), then **`ShopUserAdd`** for each missing
pair. No migration could do it: CS roles are user_service's tables, grants are selling_service's (HARD RULE 3). Going through
`ShopUserAdd` keeps its own rules: membership and suspension are checked again (`refuseUngrantable`), and **the primary rule
applies** — a shop's existing primary is never touched; a shop with **none** gets the first CS granted, lowest user id, as its
primary ([the-primary-cs-is-a-flag-on-a-grant](../business/shop/context_decision.md#the-primary-cs-is-a-flag-on-a-grant)). The
line says so (`— becomes its primary CS`).

### What it does

```mermaid
sequenceDiagram
  participant SAN as san shop grant-current-cs
  participant TEAM as team_service — TeamList
  participant USER as user_service — UserList
  participant SELL as selling_service — ShopList, ShopUserList, ShopUserAdd
  SAN->>SAN: refuse a database without teams, user_team_roles, shops, shop_users
  SAN->>TEAM: live selling teams, 200 a page, by id
  loop each team
    SAN->>USER: members, not suspended, with their role — keep role CS, lowest id first
    SAN->>SELL: ShopList — the team's live shops, each with its primary
    loop each shop
      SAN->>SELL: ShopUserList — who already holds it
      SAN->>SAN: a CS already granted, skipped
      SAN->>SELL: ShopUserAdd for each CS missing — unless --dry-run
      SELL-->>SAN: granted — the first grant on a shop with no primary becomes it
    end
  end
  SAN-->>SAN: one line per grant, then the summary
```

### Output

The dev database's first dry run (2026-11-05):

```
team 14 Dev Selling: 0 CS, 1 live shops
team 89 Selling Srengat: 0 CS, 2 live shops
team 91 Selling Developer: 1 CS, 1 live shops
  would grant sutoni (#254) on shoshoseee (#4) — becomes its primary CS
[explicit --dsn] shop grant-current-cs DRY RUN, nothing written: 3 teams, 1 CS users, 4 live shops — 1 grants would be added (1 would become a shop's primary CS), 0 skipped (already granted)
```

The real run prints `granted …` and `… — 1 grants added (1 became a shop's primary CS), 0 skipped`. A CS in two teams is
counted in each. Each grant line is printed as it is written, so an interrupted run still says what it did — and simply
runs again.

### Errors you should expect

| Error | Cause |
| --- | --- |
| `no database selected (use --dsn to run non-interactively)` | No `--dsn` / `DATABASE_URL` and no terminal to prompt on — nothing is run |
| ``this database has no selling/user/team schema — wrong --dsn, or run `san migrate up-all` first (no teams table)`` | The DSN points at a database without the services' tables. Refused, rather than "succeeding" with 0 teams |
| `grant <user> (#id) on <shop> (#id): … is not a member of this shop's team` / `… is suspended` | `ShopUserAdd` refused one between the list and the write — someone changed the team meanwhile. The grants before it are written; run it again |

---

## `warehouse carry-over-fees`

⛔ **Removed** *(2026-10-29)*, with the column it read. It was step 2 of
[the-flat-rate-is-dropped-last](../business/teams/warehouse/context_decision.md#the-flat-rate-is-dropped-last): each
warehouse's default flat `handling_fee` became its rate in warehouse_service (0%, floor = cap = the fee). Step 5 dropped
`liability_terms.handling_fee`, so there is nothing left to carry. A database must have run it **before** liability
`00011` — after that the flat fees are gone, and a warehouse without a rate takes no orders until it sets one.

---

## `user reset-password`

Sets a user's password **without knowing the old one** — the operator's equivalent of what an admin
does in the UI.

```sh
# interactive: pick the database, then type the password twice, hidden
go run ./tools/san user reset-password --username ani

# non-interactive (CI, scripts)
SAN_PASSWORD='…' go run ./tools/san user reset-password --user-id 57 --dsn "$DSN"
```

| Flag | Env | Notes |
| --- | --- | --- |
| `--username` | | |
| `--email` | | Matched case-insensitively, on `LOWER(email)` |
| `--user-id` | | The unambiguous selector |
| `--password` | `SAN_PASSWORD` | **Prompted (hidden, twice) when omitted** |

**Exactly one** of `--username` / `--email` / `--user-id` is required. Two is an error, not a
precedence rule — a script passing a stale `--username` beside a correct `--user-id` would
otherwise reset the wrong account in silence.

### What actually happens

```mermaid
sequenceDiagram
    actor Op as Operator
    participant CLI as san
    participant Target as san_dbtarget
    participant Wire as InitializeSan
    participant Svc as user_v1.AdminResetPassword
    participant DB as Postgres
    participant Cache as role cache

    Op->>CLI: user reset-password --username ani
    Note over CLI: flags checked BEFORE any database is touched — exactly one identifier, password typed twice
    CLI->>Target: Resolve(--dsn)
    Target-->>Op: Database Local or Database Production
    Op-->>Target: types "production" if that is the choice
    Target-->>CLI: dsn, label
    CLI->>Wire: InitializeSan(dsn)
    Wire-->>CLI: San — db + user_service
    CLI->>DB: find the ONE account matching the selector
    DB-->>CLI: user 57
    CLI->>CLI: protovalidate the request against the proto's own rules
    CLI->>Svc: AdminResetPassword(57, new password)
    Svc->>DB: store bcrypt hash, stamp last_password_reset
    Svc->>Cache: invalidate cached roles for 57
    Svc-->>CLI: ok
    CLI-->>Op: password reset — every existing session for this account is now dead
```

**The reset is three things, not one.** That is the whole reason this command calls the RPC handler
instead of writing an `UPDATE`:

| Step | If it were skipped |
| --- | --- |
| bcrypt hash stored | — |
| `last_password_reset` stamped | The account's **existing tokens keep working**. An operator who "locked down" a compromised account would have changed nothing for whoever holds its session. |
| cached roles evicted | Stale authorization survives a security event. |

### Output

```
password reset: dev (id=57) on Database Local — every existing session for this account is now dead
```

The database label is always in the line, so the record of what happened says **where** it happened.

### Errors you should expect

| Message | Cause |
| --- | --- |
| `name the account: --username, --email or --user-id` | No identifier given |
| `give exactly ONE of --username, --email or --user-id` | More than one given |
| `no user matches username ani` | Typo, or the account is on another database |
| `more than one user matches … — select by --user-id` | Ambiguous data — select by id |
| `validation error: new_password: must be at least 8 characters` | The **proto's** rule, applied by the CLI |

---

## `user root add` / `remove`

Adds and removes a **Root** ([root-can-be-several](../business/user/context_decision.md#root-can-be-several)). This is the only way:
no RPC gives or takes Root ([root-is-granted-only-through-san](../business/user/context_decision.md#root-is-granted-only-through-san)), and the app's own
membership write refuses to.

```sh
go run ./tools/san user root add    --username fajar
go run ./tools/san user root remove --user-id 66 --dsn "$DSN"
```

| Flag | Notes |
| --- | --- |
| `--username` · `--email` · `--user-id` | **Exactly one**, as for `user reset-password` |

### What actually happens

```mermaid
sequenceDiagram
    actor Op as Operator
    participant CLI as san
    participant Svc as user_v1.GrantRoot or RevokeRoot
    participant DB as Postgres
    participant Cache as role cache

    Op->>CLI: user root remove --username fajar
    CLI->>CLI: the database chosen — Local, or Production after typing production
    CLI->>DB: find the ONE account matching the selector
    CLI->>Svc: RevokeRoot(user, agent san)
    Svc->>DB: BEGIN, lock the account's users row
    Svc->>DB: lock EVERY Root's membership row, then count them
    alt the last Root
        Svc-->>CLI: refused — add another first
    else another Root remains
        Svc->>DB: delete the root-team membership, log it with actor san, COMMIT
        Svc->>Cache: invalidate the account's cached roles
        Svc-->>CLI: ok
    end
```

- **The lock and the history live in user_service**, not here: `GrantRoot` and `RevokeRoot` are in-process methods of
  `user_v1.Service` with no RPC in front of them. The history row names `san` as who did it
  ([every-role-change-is-logged](../business/user/context_decision.md#every-role-change-is-logged)).
- **"The last" is counted under a lock on every Root's row**, so two removals of the last two Roots run one after the
  other and the second is refused — proved by `TestInterleave_RevokeRoot_TheSecondCountsAfterTheFirst`.
- `add` turns a System Administrator into Root (one role per team) and changes nothing for an existing Root.

### Errors you should expect

| Error | Cause |
| --- | --- |
| `the last Root is never removed — add another first` | `remove` on the only Root |
| `this account is not a Root` | `remove` on anybody else |
| `a suspended or erased account is never made Root` | `add` on a suspended or erased account |
| `name the account: --username, --email or --user-id` | No selector, or more than one |

## `document sweep-generated`

[generated-files-are-kept-seven-days](../technical/architecture/context_decision.md#generated-files-are-kept-seven-days): a
file the system **made for a download** — a merged label PDF (`order_labels`), a table export (`table_export`), an order
export (`order_export`) — is kept **7 days** from when it was made. The server sweeps them **daily** on its own (a ticker
in its process: the first run a minute after it starts, then every `GENERATED_FILE_SWEEP_EVERY`, default `24h`; `0` turns
it off). This command runs the same sweep once, by hand. **Safe to re-run**: a second run finds nothing.

```sh
go run ./tools/san document sweep-generated --dry-run     # prompts Local/Production; counts, deletes nothing
go run ./tools/san document sweep-generated               # the real run, at most 1000 files
go run ./tools/san document sweep-generated --limit 5000  # a bigger run
```

| Flag | |
| --- | --- |
| `--dry-run` | Count the files a run would delete (oldest first, at most `--limit`) and their size. Deletes nothing |
| `--limit` | The most files this run deletes, oldest first. Default `1000`. A run that stops at it says so — run it again |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

**Never swept:** an uploaded file — a label, a receipt, a statement, a proof of payment, a photo — and a generated file
somebody **shared** (a share row keeps it). The objects are deleted from `DOCUMENT_STORAGE_DIR` — see
[the environment](#global-options).

It calls document_service's own `SweepGeneratedFiles` (`document_v1/generated_file_sweep.go`) — the server's lock, its
predicate, its store — never a hand-written DELETE. Two sweeps never run at once: the one that finds the lock taken stops.

### What it does

```mermaid
sequenceDiagram
  participant SAN as san document sweep-generated
  participant DOC as document_service — SweepGeneratedFiles
  participant DB as Postgres
  participant ST as the document store
  SAN->>DOC: dry-run, limit
  loop a transaction per 100 files, until the limit or nothing is left
    DOC->>DB: pg_try_advisory_xact_lock — taken means another sweep runs, stop
    DOC->>DB: the oldest generated rows made over 7 days ago, unshared, FOR UPDATE SKIP LOCKED
    DOC->>DB: delete them, re-checking for a share
    DOC->>ST: delete each object and thumbnail — a missing one is fine
    DOC->>DB: commit — a failed object delete rolls its rows back for the next run
  end
  DOC-->>SAN: swept, bytes, the cutoff, more left
  SAN-->>SAN: print it
```

### Output

The dev database (2026-11-11), which has no generated file older than a week:

```
$ san document sweep-generated --dry-run --dsn …
[explicit --dsn] DRY RUN — would sweep 0 generated file(s), 0.0 MB, made before 2026-11-04 22:17 +07
```

A run that stops at its limit adds `[…] stopped at --limit 1000: older generated files are left — run it again`.

### Errors

| Error | Cause |
| --- | --- |
| `--limit must be at least 1` | `--limit 0` or below. Checked before any database is asked for |
| `[Database Local] another generated-file sweep is running — this one stopped, the other one is doing the work` | The server's daily sweep (or another `san`) holds the sweep's lock. Nothing was deleted; run it again later, or leave it — the other one is sweeping |
| `deleting generated file <id>: …` | The store refused a delete. That batch's rows were rolled back, so the next run tries them again |

---

## `report refold`

[a-wrong-day-is-refolded-from-the-log](../business/settlement/context_decision.md#a-wrong-day-is-refolded-from-the-log):
*"one report, one shop, one date — re-read that day's log rows and rewrite that day's report row."* The repair for a
report day that is wrong while the log is right — a lost event, a fold that did not run. It **adds no log row**; the broker
replay stays for range rebuilds. **Run it when a person notices a wrong day** — nothing detects one
([a-report-is-fed-by-events-only-for-now](../business/analytic/context_decision.md#a-report-is-fed-by-events-only-for-now)).
Dry first, then for real. **Safe to re-run**: a row that already matches the log is left as it is, and a second run
changes nothing.

### Which reports it rebuilds — the fed-by table

Only an **event-fed** report can lose an event: one folded by a Pub/Sub subscriber. A report folded **inside its writer's
own transaction** is equal to its rows by construction and needs no re-fold. Every report and figure table in every
service's `db_migrations`:

| Report table (service) | Fed by | Topic → handler | Its log | Key — scope × Jakarta day | Claim (dedup) | `--report` |
| --- | --- | --- | --- | --- | --- | --- |
| `shop_settlement_daily_reports` + state `shop_settlement_reports` (settlement) | **event** | `settlement-log-posted` → `settlement_v1` `FoldHandler` (sub `settlement-fold`) | `settlement_logs` | (shop, team, day) + carried balance | `settlement_event_logs` (`settlement-log:<id>`) | **`settlement-shop-daily --shop`** |
| `user_settlement_daily_reports` + state `user_settlement_reports` (settlement) | **event** | the same fold | `settlement_logs` | (person, team, day) + carried balance | `settlement_event_logs` — shared with the shop report | **`settlement-user-daily --user`** |
| `order_daily_reports` (selling) | **event** | `order-placed` · `order-cancelled` · `order-status-changed` · `order-return-accepted` → `selling_v1` `Analytic.FoldHandler` (subs `selling-order-fold-*`) | `orders.created_at` + `order_timeline_logs` (the rows INTO cancel, return, lost, return_completed) | (day, metric, **seller team**, shop, warehouse, creator) | `order_event_logs` (`order-placed:<o>`, `order-cancelled:<o>`, `order-status-changed:<row>`, `order-return-accepted:<o>`) | **`order-daily --team`** |
| `supplier_product_daily_reports` (supplier) | **event** | `restock-accepted` → `supplier_v1` `FoldHandler` (sub `supplier-fold`); `restock-received-count-corrected` → the same (sub `supplier-count-corrected`) | inventory's accepted restocks (`inventory_v1.RestockAcceptedEventsOn` — the accept's own event builder) and received-count corrections (`RestockCountCorrectionEventsOn`) | (day, **supplier**, product, restocking team) | `supplier_event_logs` (`restock-accepted:<r>`) | **`supplier-restock-daily --supplier`** |
| `supplier_sale_daily_reports` (supplier) | **event** | `order-placed` · `order-cancelled` → `supplier_v1` `SalesFoldHandler` (subs `supplier-order-placed`, `-cancelled`) | selling's orders (`selling_v1.OrderSaleEventsOn`) and inventory's take (`OrderTakeSuppliers`) | (day, **supplier**, product, owning team) | `supplier_sale_orders` (`placed_day`, `cancelled_day` per order) + `supplier_sale_order_parts` | **`supplier-sale-daily --supplier`** |
| `expense_metric_daily_reports` (expense) | in the expense row's transaction (`metric_fold.go`) | — | `expense_records` | (day, kind, team, shop, person) | — | not needed |
| `financial_account_daily_reports` (financial_account) | in the log row's transaction (`ledger.go` `post` → `foldDay`, under the account lock) | its listeners write the LOG row; the report rides that transaction | `financial_account_logs` | (account, day) + carried balance | `financial_account_event_logs` dedups the log write | not needed |
| `inventory_lost_daily_reports` (inventory) | in the loss's transaction (`fold_lost.go`) | — | `warehouse_stock_problems` (lost) | (day, warehouse, team, product, …) | — | not needed |
| `inventory_stock_daily_changes` · `inventory_door_daily_reports` (inventory) | in the stock transaction (`inventory_ledgers/stock_report.go`, [ready-stock-is-folded-in-the-stock-changes-own-step](../business/analytic/rpc_provide_decision.md#ready-stock-is-folded-in-the-stock-changes-own-step)) | — | `batch_logs`, the door rows | (day, warehouse, owner, product, supplier, type) | — | not needed |
| `liability_balances` (liability) | in the entry's transaction (`post_entry.go`) — a running position, not a daily report | its listeners write ENTRIES (a log) | `liability_entries` | (team, counterparty) | per entry | not a report |

```sh
go run ./tools/san report refold --report settlement-shop-daily --shop 57 --date 2026-10-10 --dry-run   # prompts Local/Production
go run ./tools/san report refold --report settlement-shop-daily --shop 57 --date 2026-10-10             # the real run
go run ./tools/san report refold --report settlement-user-daily --user 7 --date 2026-10-10 --dry-run    # one person's day
go run ./tools/san report refold --report order-daily --team 89 --date 2026-10-30 --dry-run             # a seller team's order metrics
go run ./tools/san report refold --report supplier-restock-daily --supplier 2 --date 2026-07-21 --dry-run
go run ./tools/san report refold --report supplier-sale-daily --supplier 2 --date 2026-10-30 --dry-run
```

| Flag | |
| --- | --- |
| `--report` | **`settlement-shop-daily`** · **`settlement-user-daily`** · **`order-daily`** · **`supplier-restock-daily`** · **`supplier-sale-daily`** — the table above |
| `--shop` | The shop id — `settlement-shop-daily`'s scope, and only its |
| `--user` | The person's user id — `settlement-user-daily`'s scope, and only its. `--user 0` is the person report's row of "not recorded" |
| `--team` | The seller team id — `order-daily`'s scope, and only its: every metric, shop, warehouse and creator row of the team's day |
| `--supplier` | The supplier id — the two supplier reports' scope: every product and team row of the supplier's day |
| `--date` | The **Jakarta** day, `yyyy-mm-dd` — the day the report files a fact on (settlement: the rows' `posted_on`; the others: the event's instant in WIB) |
| `--dry-run` | Compute and write everything inside the transaction, print it, **roll it back** |
| `--dsn` | The [global flag](#global-options). Skips the Local/Production prompt |

A flag that is not the report's own scope is refused before any database is asked for.

Each report is rebuilt by its OWN service's method, reached through that service's package — the fold's lock, its claim
table, its statements — never a hand-written UPDATE: settlement_service's `DayRefold` (`settlement_v1/day_refold.go`),
selling_service's `Analytic.DayRefold` (`selling_v1/order_analytic_refold.go`), supplier_service's `DayRefold`
(`supplier_v1/day_refold.go`, `day_refold_sales.go`). A log another service owns is read through that service's own
function (`inventory_v1.RestockAcceptedEventsOn`, `selling_v1.OrderSaleEventsOn`, inventory's `OrderTakeSuppliers`),
handed in by san's composition root.

### Settlement — `settlement-shop-daily` · `settlement-user-daily`

[the-person-report-refolds-too](../business/settlement/context_decision.md#the-person-report-refolds-too).

| a log row of the day | counted? |
| --- | --- |
| its event is claimed in `settlement_event_logs` — by the fold, or by the other report's re-fold | ✅ — rebuilt from the log, either way |
| never claimed, written **over an hour ago** | ✅ — its event was lost. The re-fold **claims** it, so a late redelivery folds nothing |
| never claimed, written **within the hour** | ❌ — in flight. Left to the fold, which adds it after the re-fold commits |

**Whose rows a person's day holds** — the person the fold counts each row for: an order row's **creator** (stamped on the
order's account when it opened), an imported shop row's **primary CS** (`user_id`), else the row's **actor**.

The day's row is REPLACED: each type column, `change`, `open_balance` (the scope's last row before the day, as the fold
opens a day) and `close_balance` = open + change. A day the log holds nothing countable on has no row — a stray one is
removed. Then **every later day of the scope shifts** its `open_balance` and `close_balance` by exactly how far the day's
close moved ([a-refold-shifts-the-later-days](../business/settlement/context_decision.md#a-refold-shifts-the-later-days))
— the fold's own shift for a late event; their movement columns are not touched. The state row (`shop_settlement_reports`
/ `user_settlement_reports`, with the person's `last_day`) is re-derived from the newest daily row after the shift; a scope
left with no row at all reads 0 (and no `last_day`).

⚠ **One claim feeds two reports.** A lost row the re-fold claims is in its own report now, and its redelivery folds nothing
— so the **other** report is still short by it. The output names the other report's scopes and prints the command for
each; run it. That re-fold counts the claimed row like any other.

### What it does

```mermaid
sequenceDiagram
  participant SAN as san report refold
  participant SET as settlement_service — DayRefold, one transaction
  participant DB as Postgres
  SAN->>SET: report, a shop or a person, day, dry-run
  SET->>DB: process_event_lock FOR SHARE — a running replay refuses it
  SET->>DB: the scope's settlement_logs rows of the day, each with its claim, its age, its key in the other report
  SET->>DB: claim every lost row — before any advisory lock, as the fold claims before its locks
  SET->>DB: advisory lock settlement-shop or settlement-user per team, in team order — the fold's own key
  SET->>DB: re-read the claims — what is claimed now counts, the rest is in flight
  SET->>DB: replace the day's row, or remove it
  SET->>DB: shift every later day's open and close by how far the day's close moved
  SET->>DB: re-derive the state row — close, and the person's last_day
  SET-->>SAN: before and after per team, the shift, counted, claimed, in flight, the other report's short scopes
  SAN-->>SAN: print it — a dry run rolls the transaction back
```

### Output

The dev database (2026-11-05), every report day it holds, dry run then the real run — the log and both reports already
agree, so nothing moves:

```
$ san report refold --report settlement-shop-daily --shop 3 --date 2026-10-30 --dry-run
[explicit --dsn] settlement-shop-daily · shop 3 · 2026-10-30 · DRY RUN — nothing written
  log rows counted 2 · lost and now claimed 0 · in flight, left to the fold 0
  team 89: unchanged
    column                           before          after
    initial_total                   -123333        -123333
    marketplace_adjustment           100000         100000
    change                           -23333         -23333
    close_balance                    -23333         -23333
$ san report refold --report settlement-shop-daily --shop 3 --date 2026-10-30
[explicit --dsn] settlement-shop-daily · shop 3 · 2026-10-30 · re-folded
  log rows counted 2 · lost and now claimed 0 · in flight, left to the fold 0
  team 89: unchanged
    (the same table)
$ san report refold --report settlement-user-daily --user 1 --date 2026-10-30 --dry-run
[explicit --dsn] settlement-user-daily · user 1 · 2026-10-30 · DRY RUN — nothing written
  log rows counted 2 · lost and now claimed 0 · in flight, left to the fold 0
  team 89: unchanged
    column                           before          after
    initial_total                   -123333        -123333
    marketplace_adjustment           100000         100000
    change                           -23333         -23333
    close_balance                    -23333         -23333
$ san report refold --report settlement-user-daily --user 1 --date 2026-10-30
[explicit --dsn] settlement-user-daily · user 1 · 2026-10-30 · re-folded
  log rows counted 2 · lost and now claimed 0 · in flight, left to the fold 0
  team 89: unchanged
    (the same table)
$ san report refold --report settlement-user-daily --user 1 --date 2026-10-26 --dry-run
[explicit --dsn] settlement-user-daily · user 1 · 2026-10-26 · DRY RUN — nothing written
  log rows counted 1 · lost and now claimed 0 · in flight, left to the fold 0
  team 91: unchanged
    column                           before          after
    initial_total                   -123323        -123323
    change                          -123323        -123323
    close_balance                   -123323        -123323
$ san report refold --report settlement-user-daily --user 1 --date 2026-10-26
[explicit --dsn] settlement-user-daily · user 1 · 2026-10-26 · re-folded
  (the same lines)
```

A repair — a lost row on a shop's day (`tools/san/report_test.go`, the test database), then the person re-fold it names:

```
[test] settlement-shop-daily · shop 41 · 2026-02-03 · re-folded
  log rows counted 1 · lost and now claimed 1 · in flight, left to the fold 0
  team 9: row added
    column                           before          after
    fund                                  0          25000  ←
    change                                0          25000  ←
    close_balance                         0          25000  ←
    later days: none — the close moved by +25000
  ⚠ 1 row(s) were never folded: settlement-user-daily is still short by them — a redelivery no longer folds them. Run:
      go run ./tools/san report refold --report settlement-user-daily --user 3 --date 2026-02-03
[test] settlement-user-daily · user 3 · 2026-02-03 · re-folded
  log rows counted 1 · lost and now claimed 0 · in flight, left to the fold 0
  team 9: row added
    ...
```

| line | means |
| --- | --- |
| `later days: N shifted by +X — open/close only, their movement untouched` | the day's close moved by X, and so did every later day's carry |
| `⚠ the next day, D, opens +X off this day's close — its carry was off before this re-fold; re-fold D to close it` | the next row's carry was already broken (a shift keeps a break). Re-folding D re-opens it from this day's close |
| `⚠ N row(s) were never folded: <other report> is still short by them … Run:` | the lost rows are claimed now; run each printed command so the other report counts them too |

### Order metrics — `order-daily`

selling_service's `Analytic.DayRefold`. The log is the team's orders and their timeline — the very rows each event was
built from, one event per move — and every figure is the order's own frozen one, as the fold reads it:

| Move on the day | Its event (the claim's id) | Row |
| --- | --- | --- |
| an order placed (`orders.created_at`) | `order-placed:<order>` | `created` +1, `total_cost`, `platform_total` — and `warehouse_fee` +1, the fee, for an order with one |
| the timeline row INTO `cancel` | `order-cancelled:<order>` | `cancelled` +1 … — and `warehouse_fee` −1, −the fee |
| a timeline row INTO `return` / `lost` | `order-status-changed:<timeline row>` | `return_created` / `lost_created` |
| the timeline row INTO `return_completed` | `order-return-accepted:<order>` | `return_arrived` |

### A supplier's figures — `supplier-restock-daily` · `supplier-sale-daily`

supplier_service's `DayRefold`. Supplier owns no source rows — only its claims — so a day is rebuilt from **what its
claims hold** (exactly what the fold folded: the claimed event's `raw`, or the order's parts), and the other services' log
is asked only for the events nobody claimed:

| Report | Counted from the claims | A lost event, claimed the fold's way |
| --- | --- | --- |
| `supplier-restock-daily` | every `supplier_event_logs` row of the day whose `RestockAccepted` names the supplier — its lines, by the fold's arithmetic | the accept's event, rebuilt by inventory's own builder, inserted as its claim |
| `supplier-sale-daily` | the supplier's parts of every order with `placed_day` = the day, added, and of every order with `cancelled_day` = the day whose placement was folded, taken back | a placement: its `placed_day` and its parts, priced by the fold's `saleParts` from inventory's take · a cancel: its `cancelled_day` |

⚠ **One order feeds several suppliers, and its cancel another day.** A lost placement the Penjualan re-fold claims counts
for this supplier's day only; every other supplier its parts name — and the cancel's day, when the late placement had been
cancelled already — is then short by it. The output names each and prints its command; run them.

A claimed restock event is counted **as it was folded**: a restock edited after its accept leaves the folded day alone.
Claims older than 45 days are pruned (`AnalyticMaintenanceRun`), so an older day's accepts read as never claimed — they are
rebuilt from inventory and claimed again, which is the same figure. A replay holding `process_event_lock` refuses the
restock re-fold, as it refuses the fold.

### The lock — the three reports with no advisory key

The order and supplier folds take no advisory lock: each claims, then upserts — and the upsert holds ROW EXCLUSIVE on the
report until it commits. So the re-fold claims the lost events first (the fold's order), then takes the report in
**SHARE ROW EXCLUSIVE**: it waits for every fold that already wrote, and every fold that has not yet written waits for it.
Reads are not blocked. Under the lock the claims are re-read, so a fold still waiting — its claim invisible — is not
counted and adds its event after the replace. None of the three carries a balance, so no later day moves.

```mermaid
sequenceDiagram
  participant SAN as san report refold
  participant SVC as the report's service — DayRefold, one transaction
  participant LOG as the log's service — its own function, read before
  participant DB as Postgres
  SAN->>SVC: report, a team or a supplier, day, dry-run
  SVC->>LOG: the day's moves — orders and timeline, accepts, or orders and their takes
  SVC->>DB: process_event_lock FOR SHARE — supplier-restock-daily only
  SVC->>DB: claim every lost event — older than an hour, never claimed — the fold's own claim
  SVC->>DB: LOCK TABLE the report IN SHARE ROW EXCLUSIVE — waits for every fold that already wrote
  SVC->>DB: re-read the claims — what is claimed now counts, the rest is in flight
  SVC->>DB: replace each row that differs, remove the rows the log does not hold
  SVC-->>SAN: before and after per row, counted, claimed, in flight, the other scopes left short
  SAN-->>SAN: print it — a dry run rolls the transaction back
```

The dev database (2026-11-12), dry runs only:

```
$ san report refold --report order-daily --team 89 --date 2026-10-30 --dry-run
[explicit --dsn] order-daily · team 89 · 2026-10-30 · DRY RUN — nothing written
  moves counted 1 · lost and now claimed 0 · in flight, left to the fold 0
  created · shop 3 · warehouse 13 · user 1: unchanged
    column                             before          after
    order_count                             1              1
    total                              25.836         25.836
    mp_total                          123.333        123.333
  warehouse_fee · shop 3 · warehouse 13 · user 1: row added
    column                             before          after
    order_count                             0              1  ←
    total                                   0         15.000  ←
$ san report refold --report order-daily --team 89 --date 2026-08-14 --dry-run
[explicit --dsn] order-daily · team 89 · 2026-08-14 · DRY RUN — nothing written
  moves counted 2 · lost and now claimed 2 · in flight, left to the fold 0
  created · shop 1 · warehouse 2 · user 0: row added
    column                             before          after
    order_count                             0              2  ←
    total                                   0        100.036  ←
    mp_total                                0         12.333  ←
$ san report refold --report supplier-restock-daily --supplier 2 --date 2026-07-21 --dry-run
[explicit --dsn] supplier-restock-daily · supplier 2 · 2026-07-21 · DRY RUN — nothing written
  events counted 1 · lost and now claimed 0 · in flight, left to the fold 0
  product 1 · team 89: unchanged
    column                             before          after
    restock_count                          50             50
    restock_valuation               2.500.000      2.500.000
  product 2 · team 89: unchanged
    column                             before          after
    restock_count                          23             23
    restock_valuation                 200.000        200.000
```

The first two are real gaps on the dev data, left as they are: order 6's placement is claimed but its Warehouse Fee row is
missing (the fee row joined the fold on 2026-11-05, after the order), and orders 3–4 were never folded (no claim). A real
run repairs each.

A Penjualan repair (`tools/san/report_test.go`, the test database) — a lost placement priced from inventory's take:

```
[test] supplier-sale-daily · supplier 77 · 2026-02-03 · re-folded
  events counted 1 · lost and now claimed 1 · in flight, left to the fold 0
  product 901 · team 12: row added
    column                             before          after
    sales_count                             0              3  ←
    sales_value                             0         45.000  ←
```

| line | means |
| --- | --- |
| `⚠ the lost sales claimed here also count for N other supplier day(s) … Run:` | the lost placements or cancels are claimed now; run each printed command so the other suppliers' days — and a cancel's own day — count them too |

### Errors you should expect

| Error | Cause |
| --- | --- |
| `the re-fold rebuilds settlement-shop-daily, settlement-user-daily, order-daily, supplier-restock-daily, supplier-sale-daily` | another `--report` |
| `--report order-daily re-folds one seller team: give --team, not --shop` (and every report's mirror) | another report's scope flag |
| `order-daily re-folds one seller team: a team id is required` | `order-daily` with no `--team` |
| `a supplier re-fold names one supplier: a supplier id is required` | a supplier report with no `--supplier` |
| `a replay holds the fold's lock (process_event_lock) — run the re-fold after it` (supplier) | supplier's `AnalyticReplayCompute` is running — `supplier-restock-daily` only |
| `settlement-shop-daily re-folds one shop: a shop id is required` | the shop report with no `--shop` (or `--shop 0`) |
| `settlement-user-daily re-folds one person: a user id is required` | the person report with no `--user` |
| `--report settlement-shop-daily re-folds one shop: give --shop, not --user` (and the person report's mirror) | both scopes, or the other report's flag |
| `date must be YYYY-MM-DD` | `--date` is not a day |
| `a replay holds the fold's lock (process_event_lock) — run the re-fold after it` | `AnalyticReplayCompute` is running. Wait for it (the lease is a minute) and run again |
| `settlement re-fold: log row N has settlement_type "x", which has no report column` | a type the fold cannot file either — the fold dead-letters the same row |

---

## `pubsub ensure`

```sh
# dev, against the local emulator — dev run, dev setup and the e2e setup run this for you
go run ./tools/san pubsub ensure --project warehouse-dev --emulator

# production: the grants need the NUMERIC project id, and push needs the base URL
go run ./tools/san pubsub ensure --project warehouse-prod --project-number 123456789012   --push-base-url https://api.example.com
```

**Nothing creates topics or subscriptions except this command.** No service checks its setup at
startup ([services-do-not-verify-setup-at-boot](../technical/event_architecture/context_decision.md#services-do-not-verify-setup-at-boot)),
which is what keeps admin permissions out of the server — and the trade it accepts: a push route whose
subscription nobody created receives nothing and says nothing.

**It ENSURES, so run it as often as you like** — creating what is missing, updating what may change, and
REFUSING what Pub/Sub cannot change. It never deletes
([setup-ensures-safe-defaults-never-deletes](../technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)).

**An unchanged subscription gets no write.** Only the settings that DIFFER go in the update. It used to send
all five every run, and the emulator refuses any update naming `expiration_policy` — so every SECOND run
failed, which is exactly what `dev run` and the e2e setup do on each start.

**The topics come from the PROTO**, not from a list here: every variant of `warehouse.events.v1.Event`
declares its own topic, and the command walks the descriptor. Add a variant, re-run, and its topic
exists — there is no list to forget.

| flag | |
| --- | --- |
| `--project` | required — the GCP project id, or any stable id against the emulator |
| `--emulator` | talk to the local emulator (`PUBSUB_EMULATOR_HOST`, default `localhost:8085`) |
| `--push-base-url` | base URL for PUSH subscriptions. Omit for pull |
| `--project-number` | the NUMERIC project id, which names the Pub/Sub service agent the dead-letter grants go to. Omit against the emulator, which has no IAM |
| `--topics-only` | stop after the topics, their DLQs and the triage subscriptions |

```mermaid
sequenceDiagram
    participant P as the proto
    participant S as san pubsub ensure
    participant G as Pub/Sub
    S->>P: walk every Event variant
    P-->>S: order-placed, order-cancelled, settlement-log-posted
    S->>G: topic + 31-day retention
    S->>G: topic.dlq
    S->>G: topic.dlq.triage — never expires
    S->>G: each declared subscription, every default
    G-->>S: one already exists and its filter differs
    S-->>S: REFUSE, naming the subscription and the field
```

**The subscriptions it declares** (`declaredSubscriptions` in `tools/san/pubsub.go`, each mirroring a
constant beside the handler that serves it):

| id | topic | consumer |
| --- | --- | --- |
| `liability-order-placed` | `order-placed` | liability charges an order's fees |
| `liability-order-cancelled` | `order-cancelled` | liability reverses them |
| `settlement-order-placed` | `order-placed` | settlement opens the order's account — its `initial_total` ([settlement-opens-the-sale-from-the-order-event](../business/settlement/context_decision.md#settlement-opens-the-sale-from-the-order-event)) — push route `/event/settlement-order-placed/push` |
| `settlement-order-cancelled` | `order-cancelled` | settlement cancels that sale — its `initial_total_cancel` — push route `/event/settlement-order-cancelled/push` |
| `settlement-fold` | `settlement-log-posted` | settlement's reports fold — push route `/event/settlement-fold/push` |
| `financial-account-withdrawal` | `settlement-log-posted` | a shop's withdrawals post into its financial account — push route `/event/financial-account-withdrawal/push` |
| `supplier-fold` | `restock-accepted` | a supplier's figures fold — push route `/event/supplier-fold/push` ([the-report-is-processed-like-settlement](../business/supplier/context_decision.md#the-report-is-processed-like-settlement)) |
| `supplier-count-corrected` | `restock-received-count-corrected` | the same fold, from a received-count correction, on its own day — push route `/event/supplier-count-corrected/push` ([a-received-count-correction-counts-on-its-own-day](../business/inventory/adjustment_decision.md#a-received-count-correction-counts-on-its-own-day)) |
| `supplier-order-placed` | `order-placed` | Penjualan — the sales fold adds an order's sale of each supplier's goods on its Jakarta day ([penjualan-is-the-selling-value-on-the-order-day](../technical/frontend/suppliers_decision.md#penjualan-is-the-selling-value-on-the-order-day)) — push route `/event/supplier-order-placed/push`. Not seeked by any replay |
| `supplier-order-cancelled` | `order-cancelled` | Penjualan — the same fold takes the sale back on the cancel's own day — push route `/event/supplier-order-cancelled/push` |
| `liability-restock-accepted` | `restock-accepted` | the selling team owes the warehouse the courier's charge at a restock's door, posted once per restock ([balance-posts-the-couriers-debt-from-the-event](../business/inventory/restock_decision.md#balance-posts-the-couriers-debt-from-the-event)) — push route `/event/liability-restock-accepted/push` |
| `liability-order-return-accepted` | `order-return-accepted` | the selling team owes the warehouse the courier's charge at a return's door, posted once per order as a `return_incidental_fee` ([a-return-may-carry-the-couriers-ask](../business/balance/context_decision.md#a-return-may-carry-the-couriers-ask)) — push route `/event/liability-order-return-accepted/push` |
| `selling-order-fold-return-accepted` | `order-return-accepted` | the order metrics count Return Arrived from the warehouse's accept ([the-accept-is-the-status-return-completed](../business/order/context_decision.md#the-accept-is-the-status-return-completed)) — push route `/event/selling-order-fold-return-accepted/push` |
| `selling-member-removed` | `member-removed` | a person removed from a team loses their grants on its shops ([removing-a-member-drops-their-shop-access](../business/user/context_decision.md#removing-a-member-drops-their-shop-access)) — push route `/event/selling-member-removed/push` |
| `financial-account-team-payment` | `liability-payment-accepted` | an accepted team payment posts out of the payer's account and into the creditor's ([a-team-payment-posts-on-accept](../business/financial_account/context_decision.md#a-team-payment-posts-on-accept)) — push route `/event/financial-account-team-payment/push` |
| `financial-account-restock-created` | `restock-created` | a restock's payment, goods plus shipping, out of the account it names ([a-created-restock-tells-the-financial-account](../business/inventory/restock_decision.md#a-created-restock-tells-the-financial-account)) — push route `/event/financial-account-restock-created/push` |
| `financial-account-restock-updated` | `restock-updated` | an edit's difference, or the whole payment moved to another account ([an-edit-sends-the-difference](../business/inventory/restock_decision.md#an-edit-sends-the-difference), [an-edit-may-move-the-payment-to-another-account](../business/inventory/restock_decision.md#an-edit-may-move-the-payment-to-another-account)) — push route `/event/financial-account-restock-updated/push` |
| `financial-account-restock-cancelled` | `restock-cancelled` | the refund when the money came back ([a-restock-names-its-paying-account](../business/inventory/restock_decision.md#a-restock-names-its-paying-account)) — push route `/event/financial-account-restock-cancelled/push` |
| `financial-account-expense-created` | `expense-created` | an expense out of the account that paid it — `ads_expense` for an ADS expense, `expense` for the rest; nothing for a STOCK_LOSS or an expense with no account ([an-expense-must-name-the-account-that-paid](../business/financial_account/context_decision.md#an-expense-must-name-the-account-that-paid), [ads-expense-joins-the-types](../business/financial_account/context_decision.md#ads-expense-joins-the-types)) — push route `/event/financial-account-expense-created/push` |
| `financial-account-expense-adjusted` | `expense-adjusted` | an expense's correction — its signed difference on the ORIGINAL expense's account, a cancel giving the net back ([a-correction-follows-the-expenses-account](../business/financial_account/context_decision.md#a-correction-follows-the-expenses-account)) — push route `/event/financial-account-expense-adjusted/push` |
| `liability-warehouse-transfer-accepted` | `warehouse-transfer-accepted` | the selling team owes the receiving warehouse the courier's charge at its door, posted once per transfer as a `transfer_fee` ([a-transfer-charge-is-a-transfer-fee](../business/balance/context_decision.md#a-transfer-charge-is-a-transfer-fee)) — push route `/event/liability-warehouse-transfer-accepted/push` |
| `financial-account-warehouse-transfer-created` | `warehouse-transfer-created` | a warehouse transfer's shipping cost, as `expense`, out of the account it names ([a-transfers-shipping-posts-as-an-expense](../business/financial_account/context_decision.md#a-transfers-shipping-posts-as-an-expense)) — push route `/event/financial-account-warehouse-transfer-created/push` |
| `financial-account-warehouse-transfer-updated` | `warehouse-transfer-updated` | a cost edit's difference, or the whole cost moved to another account ([the-shipping-expense-reaches-the-account-by-event](../business/inventory/warehouse_transfer_decision.md#the-shipping-expense-reaches-the-account-by-event)) — push route `/event/financial-account-warehouse-transfer-updated/push` |
| `financial-account-warehouse-transfer-cancelled` | `warehouse-transfer-cancelled` | the refund of whatever was posted for the trip — push route `/event/financial-account-warehouse-transfer-cancelled/push` |
| `inventory-tx-cancel` | `inventory-tx-cancel` | inventory releases the stock take of an order create that failed after it, by the order's key — the backup of the order's direct release ([the-compensation-event-is-inventory-tx-cancel](../business/order/context_decision.md#the-compensation-event-is-inventory-tx-cancel), [the-release-is-direct-then-the-event](../business/order/context_decision.md#the-release-is-direct-then-the-event)). A cancel that meets a stock count is NACKed on purpose and redelivered until the count ends, so its dead-letter holds the ones that outlasted the retry limit — give them back with [`pubsub releases replay`](#pubsub-releases) ([a-stuck-release-is-replayed-by-san](../business/order/context_decision.md#a-stuck-release-is-replayed-by-san), [a-cancel-still-meets-the-count-first](../business/order/context_decision.md#a-cancel-still-meets-the-count-first)) — push route `/event/inventory-tx-cancel/push` |
| `inventory-order-cancelled` | `order-cancelled` | inventory releases a cancelled order's stock take by the order's key — the cancel no longer releases inside its own flow ([inventory-returns-stock-on-order-cancelled](../business/order/context_decision.md#inventory-returns-stock-on-order-cancelled), [every-release-goes-by-the-key](../business/order/context_decision.md#every-release-goes-by-the-key)). A release that meets a stock count (a cancel that slipped past the order's count check) is NACKed on purpose and redelivered until the count ends; the dead-letter holds the ones that outlasted the retry limit — give them back with [`pubsub releases replay`](#pubsub-releases) once the count is over, which leaves the other consumers' dead-letters on the same `.dlq` alone ([a-stuck-release-is-replayed-by-san](../business/order/context_decision.md#a-stuck-release-is-replayed-by-san), [a-cancel-still-meets-the-count-first](../business/order/context_decision.md#a-cancel-still-meets-the-count-first)) — push route `/event/inventory-order-cancelled/push` |

⚠ **`settlement-fold` and `supplier-fold` (with `supplier-count-corrected`) are SEEKED by their service's `AnalyticReplayCompute`**, which reaches back as far as the topic's
31-day retention. The replay reads that reach from Pub/Sub itself, so a topic created by anything other
than this command — with a shorter retention — shortens the replay rather than breaking it.

**What every subscription gets, and why each one matters:**

| default | what its absence does, silently |
| --- | --- |
| dead-letter policy → `<topic>.dlq`, 5 attempts | a failing message redelivers forever, and every delivery attempt reads 0 |
| the two IAM grants | without them nothing dead-letters and no error says so |
| `expiration_policy` with no TTL | deleted after 31 idle days — quiet exactly when things are healthy |
| `enable_message_ordering` on | fixed at creation. Off, adding an ordering key later means recreating every subscription |
| retry backoff 10s → 600s | unset, Pub/Sub retries "as soon as possible": a 30-second outage burns all five attempts |
| push ack deadline 60s | it is also the HTTP timeout, and the default is 10 — a slower fold is cancelled and dead-lettered |
| a filter on `event_type` | a variant this consumer has not regenerated arrives as a recorded rejection. ⚠ IMMUTABLE — it cannot be added later |

**Errors it can return:**

| | |
| --- | --- |
| `subscription %q names topic %q, which no event variant declares` | a typo. Creating it would be silence that looks like health |
| `... Pub/Sub cannot change it, and this tool never deletes` | the topic, filter or ordering of an existing subscription moved. Declare a NEW id and retire the old one once it is drained |
| `⚠ not declared here, left alone: ...` | not an error. A subscription nobody here declares — usually someone else's consumer, or a rename mid-flight |

---

## `pubsub redrive`

```sh
go run ./tools/san pubsub redrive --project warehouse-dev --topic order-placed --emulator
```

Pulls everything from `<topic>.dlq.triage`, re-publishes it to `<topic>` unchanged, and acks it. It
stops after 15 seconds of quiet — Pub/Sub has no "is it empty".

**Run it once the cause is FIXED, and never on a schedule.** A message that still fails would loop back
into the DLQ and out again forever. Running it twice is safe: every consumer claims on `event_id`, so
anything that did get through the first time is a duplicate the second.

⚠ **What reaches a DLQ is a message whose HANDLER kept failing** — five attempts. A message that could
not be decoded never gets there: the receiver records it and acks
([reject-never-nacks](../../guidelines/architectures/event_library.md#reject-never-nacks)), so redrive
is not where you look for those.

## `pubsub releases`

```sh
# what is stuck — touches nothing
go run ./tools/san pubsub --project warehouse-dev --emulator releases list
# what a replay would give back — touches nothing
go run ./tools/san pubsub --project warehouse-dev --emulator releases replay --dry-run
# give it back: asks Local/Production (or takes --dsn), then releases through inventory's own listener
go run ./tools/san pubsub --project warehouse-dev --emulator releases replay
```

A **stuck release** is a stock release that kept failing and was dead-lettered, so the stock stays taken
([a-stuck-release-is-replayed-by-san](../business/order/context_decision.md#a-stuck-release-is-replayed-by-san)).
Inventory gives an order's stock back from two events — `InventoryTxCancel` (a create that failed after its take) and
`OrderCancelled` (a cancelled order) — and a release that meets a stock count past the retry limit, or a database outage
longer than the backoff, ends in `inventory-tx-cancel.dlq` / `order-cancelled.dlq`. This command reads both triage
subscriptions and gives those releases back.

| Flag | |
| --- | --- |
| `--project`, `--emulator` | on `pubsub`, as for every `pubsub` command |
| `--quiet` | stop reading a dead-letter after this long with no NEW message (default `5s`) — Pub/Sub has no "is it empty" |
| `--dry-run` (`replay`) | print what would be replayed; release nothing, remove nothing, ask for no database |
| `--dsn` (root) | the database `replay` writes to; without it the Local/Production prompt (`san_dbtarget`) |

**The replay calls INVENTORY'S OWN LISTENER in-process** — `inventory_service.NewInventoryPushHandler`, the handler behind
`/event/inventory-tx-cancel/push` and `/event/inventory-order-cancelled/push` — so a replay is judged exactly as the
delivery that failed (HARD RULE 3b: a command calls the handler, never a hand-written UPDATE).

- **Safe to run twice.** The release goes by the order's key, and a key is released once
  ([a-used-key-is-never-cancelled](../business/order/context_decision.md#a-used-key-is-never-cancelled)): a second replay
  of the same event finds it released (or claimed) and does nothing.
- **Acked only on success.** A message leaves the dead-letter only when the release answered nil; one that still fails
  (the count is still open) is left where it was, said `STILL FAILS`, and the command exits non-zero.
- **Only inventory's dead-letters.** `order-cancelled` has four subscribers sharing one `.dlq`. Pub/Sub stamps each
  dead-letter with `CloudPubSubDeadLetterSourceSubscription` (the short id) and `…SubscriptionProject`; a message from
  settlement, liability or the order fold is **left untouched** for that consumer's own [`pubsub redrive`](#pubsub-redrive).
  A message with no source named was put there by hand and is taken as a release.
- **Not `pubsub redrive`**, which republishes to the SOURCE topic and so redelivers an `OrderCancelled` to every
  subscriber. This command only ever releases stock.

```mermaid
sequenceDiagram
    participant P as operator
    participant S as san pubsub releases
    participant Q as topic.dlq.triage
    participant I as inventory listener, in-process
    P->>S: list, replay --dry-run, or replay
    S->>Q: pull inventory-tx-cancel.dlq.triage, then order-cancelled.dlq.triage
    Q-->>S: each dead-letter once, until quiet
    alt another consumer's dead-letter, or not a release
        S->>Q: NACK - left
    else list or dry-run
        S->>Q: NACK - left, printed
    else replay
        S->>I: the event, as the push route hands it
        alt released, or already released
            I-->>S: nil
            S->>Q: ACK - removed
        else still fails
            I-->>S: the error
            S->>Q: NACK - left, said
        end
    end
```

### Output — a real run against the dev emulator (2026-11-05)

Two releases were made to fail for real: an `InventoryTxCancel` and an `OrderCancelled` published while the dev API
was down, so every push failed and the emulator dead-lettered them after five attempts — the `OrderCancelled` from all
four of its subscribers.

```text
$ go run ./tools/san pubsub --project warehouse-dev --emulator releases list
inventory-tx-cancel.dlq (inventory's inventory-tx-cancel):
  3  InventoryTxCancel key=dev-stuck-tx-1793865195 team=2 warehouse=3 (inventory-tx-cancel:dev-stuck-tx-1793865195) · 0 attempts
order-cancelled.dlq (inventory's inventory-order-cancelled):
  4  dead-lettered by selling-order-fold-cancelled — not a release, left for that consumer's redrive
  7  dead-lettered by liability-order-cancelled — not a release, left for that consumer's redrive
  5  dead-lettered by settlement-order-cancelled — not a release, left for that consumer's redrive
  6  OrderCancelled order=9001 key=dev-stuck-cancel-1793865195 team=2 warehouse=3 (order-cancelled:9001) · 0 attempts
2 stuck releases, nothing replayed; 3 other messages left

$ go run ./tools/san pubsub --project warehouse-dev --emulator releases replay --dry-run
…the same two · would replay — 2 stuck releases, nothing replayed; 3 other messages left

$ go run ./tools/san --dsn "<local>" pubsub --project warehouse-dev --emulator releases replay
replaying into explicit --dsn
inventory-tx-cancel.dlq (inventory's inventory-tx-cancel):
INFO InventoryTxCancel handled idempotency_key=dev-stuck-tx-1793865195 team_id=2 transaction_id=0 released=false
  3  InventoryTxCancel key=dev-stuck-tx-1793865195 … · replayed, removed from the dead-letter
order-cancelled.dlq (inventory's inventory-order-cancelled):
  4  dead-lettered by selling-order-fold-cancelled — not a release, left for that consumer's redrive
  7  dead-lettered by liability-order-cancelled — not a release, left for that consumer's redrive
INFO OrderCancelled handled order_id=9001 idempotency_key=dev-stuck-cancel-1793865195 team_id=2 transaction_id=0 released=false
  6  OrderCancelled order=9001 key=dev-stuck-cancel-1793865195 … · replayed, removed from the dead-letter
  5  dead-lettered by settlement-order-cancelled — not a release, left for that consumer's redrive
2 stuck releases: 2 replayed, 0 still failing; 3 other messages left
```

Both keys had no take behind them (`released=false`, `transaction_id=0`), so inventory **claimed** each with none — a
take arriving late under either key is refused. The same `InventoryTxCancel` put back into the dead-letter by hand and
replayed again was handled once more as a no-op, and inventory still holds ONE claim per key. (`0 attempts` there is
from before the count was read off `CloudPubSubDeadLetterSourceDeliveryCount`; the triage subscription itself never
sets a delivery attempt.)

### Errors you should expect

| Message | Meaning |
| --- | --- |
| `reading <topic>.dlq.triage: … Subscription does not exist` | the topics were never ensured on this broker — run [`pubsub ensure`](#pubsub-ensure) (the emulator forgets them on a restart) |
| `STILL FAILS, left in the dead-letter: … waits for the stock count` | the count holding the rack is still open; finish it, then replay again |
| `N releases still fail — fix the cause … and run again` | the exit error after a replay that left any failure |
| `cannot be decoded … — left` | not an event this build reads; nothing is done with it |

---

## `remote`

Serves this checkout to an **AI coding agent working from somewhere else**: it runs shell commands
in the working tree and **streams the output as it is produced**, so the agent sees a build fail on
line 40 instead of waiting for the whole run to come back at once.

```sh
# from the repo root — serves the current directory on 127.0.0.1:8099
go run ./tools/san remote

# `serve` is the explicit spelling of the same thing
go run ./tools/san remote serve --root . --addr 127.0.0.1:8099
```

It prints a banner and then stays in the foreground:

```
san remote — serving D:\pdcgo\warehouse_revamp
  address    127.0.0.1:8099
  shell      pwsh -NoProfile -NonInteractive -Command
  token      cjcVOGn-sVONkQzIvgVRWzjcMjQl1q_QtJYxzKmZNG0
  expires    2026-09-19T17:06:19+07:00
  stored     D:\pdcgo\warehouse_revamp\.san\remote-token.json
             ↳ REUSED from the store — clients holding it still work

  try it:    go run ./tools/san remote exec -- "go build ./..."
```

> ⚠ **This is not a sandbox.** Whoever holds the token can run whatever you can run — the workspace
> root stops a mistyped path, not a determined caller, because the command itself can `cd` anywhere.
> The protection is the **token** and the **bind address**. Every command that runs is printed on
> your terminal, which is the other half of the deal: you can watch what the agent does.

### The token belongs to the workspace

There is no shared secret and no hand-edited credential. `san remote` generates **256 bits of
randomness**, prints it once, and that token is the only thing that authorizes a caller.

**It is kept, and reused.** The credential lives in `.san/remote-token.json` under the workspace
root, so restarting the server does **not** invalidate it — see
[below](#persistence-and-rotation) for the store, the 30-day deadline and `--new-token`.
`--no-persist-token` goes back to a token that dies with the process.

```mermaid
sequenceDiagram
    actor Op as Operator
    participant CLI as san remote
    participant Store as .san/remote-token.json
    participant Svc as RemoteService
    actor Agent as coding agent

    Op->>CLI: go run ./tools/san remote
    CLI->>Store: read
    alt stored and still valid
        Store-->>CLI: the same token as last run
    else missing, expired or --new-token
        CLI->>CLI: mint 256 random bits, base64url
        CLI->>Store: write 0600, with its expiry
    end
    CLI-->>Op: banner — address, shell, TOKEN, reused or minted
    Op->>Agent: hands over the token, once
    Agent->>Svc: Info + Authorization Bearer token
    Svc-->>Agent: workspace root, shell, expiry
    Agent->>Svc: Exec + Authorization Bearer token
    Note over Svc: token verified BEFORE the first message is read
    Svc-->>Agent: stream of stdout / stderr frames
    Svc-->>Agent: final frame — exit code, timed_out, duration
    Op->>CLI: Ctrl-C, then start it again
    Note over CLI,Agent: same token — the agent's URL still works
```

**Why not the warehouse's own token?** The caller is a program, not a person with roles in a team,
so there is no identity to carry and no role to look up — and minting a fake user would put a shell
behind the credential the login screen also accepts.

It also guards streams the warehouse interceptor cannot. The
[access interceptor](../../backend/services/user_service/access_interceptors/) reads its team scope
from the request **body**, so it authorizes a server stream on its one request and **refuses client
and bidi streams**, which carry many. A bearer token is a **header** — it is there before the first
message — so `remote`'s own interceptor guards unary and every kind of stream alike.

### Persistence and rotation

A fresh token per run is right when the token is pasted into a terminal. It is **wrong when it is
pasted into a settings screen** — and that is the case this server exists to serve: a hosted MCP
connector holds `https://…/mcp/<token>` as configuration, so a token that changed on every restart
would silently break a URL somebody has to go and edit. **So the token persists by default.**

```
  token      aFNbeU7uYEePUxPr8oZnnVh9jm-BcRgvX5k07Z1FMRw
  expires    2026-09-19T17:06:19+07:00
  stored     D:\pdcgo\warehouse_revamp\.san\remote-token.json
             ↳ REUSED from the store — clients holding it still work
```

That second line is the point: `REUSED` versus `minted and stored` answers "do I have to re-paste
this?" without comparing two 43-character strings.

| | |
| --- | --- |
| Where | `.san/remote-token.json` under the **workspace root**, `0600` in a `0700` directory, written atomically. `.gitignore`d |
| What is in it | the token, when it was issued, and **when it expires** — the expiry travels with the value, or nothing can tell a live store from a dead one |
| Move it | `--token-store <path>` / `SAN_REMOTE_TOKEN_STORE`. A relative path resolves against `--root`, not against your shell's directory, so the same workspace means the same token |
| Rotate | `--new-token` mints over the stored one, and says so — after a rotation every client holding the old token must be re-pasted |
| Turn it off | `--no-persist-token` — nothing is read, nothing is written, and the token dies with the process. Pairing it with `--token-store` is refused rather than silently resolved |

**A persisted token gets a 30-day deadline.** A run-lifetime token needs no expiry — Ctrl-C *is* the
expiry — but a stored one has none, and without a TTL the default would leave a permanent shell
credential in a file. `--token-ttl` overrides it. The stored deadline is **absolute**: reusing a
token keeps the expiry it was written with, because re-stamping it as `now + ttl` on each start
would mean a server restarted daily carried one token forever.

When the deadline passes, the next start mints a new token **and says why** on the banner, so a URL
that stopped working has an explanation on screen.

```mermaid
flowchart TD
    S["san remote"] --> T{"--token given?"}
    T -->|yes| U["use it — the store is neither read nor written"]
    T -->|no| P{"--no-persist-token?"}
    P -->|yes| E["mint for this run only — dies with the process"]
    P -->|no| N{"--new-token?"}
    N -->|yes| M["mint, store, warn: re-paste your clients"]
    N -->|no| L{"store readable and still valid?"}
    L -->|yes| R["REUSE it — the URL an agent holds still works"]
    L -->|expired| M2["mint, store, say the old one expired"]
    L -->|missing| M3["mint and store — the first run here"]
    L -->|unreadable| M4["mint, replace it, say so — never a failed startup"]
```

⚠ **`--token-file` is a different thing**: a bare token written out for a supervisor to read,
rewritten every run, never read back. The store carries the expiry and *is* read back.

The client commands (`remote exec`, `remote get`, `remote put`) read the store too, so `--token` is
optional locally:

```sh
go run ./tools/san remote exec -- "go build ./..."     # finds .san/remote-token.json itself
```

### Flags

| Flag | Env | Default | Notes |
| --- | --- | --- | --- |
| `--addr` | | `127.0.0.1:8099` | Anything that is not loopback prints a loud warning |
| `--root` | | the current directory | The workspace. Every `working_dir` resolves inside it |
| `--shell` | | `sh -c`, or PowerShell on Windows | e.g. `"bash -lc"`. Split on spaces |
| `--token` | `SAN_REMOTE_TOKEN` | *minted* | Supply your own instead of minting one |
| `--token-file` | | | Also write the token here, `0600`. Write-only — the [store](#persistence-and-rotation) is the one that is read back |
| `--token-store` | `SAN_REMOTE_TOKEN_STORE` | `.san/remote-token.json` | Where the token is [kept between runs](#persistence-and-rotation); relative to `--root` |
| `--no-persist-token` | | off | Do not keep it — mint for this run only, dying with the process |
| `--new-token` | | off | Mint over the stored token — the rotation |
| `--token-ttl` | | **30d**, or *none* under `--no-persist-token` | Expire the token |
| `--exec-timeout` | | `10m` | Used when a request does not name one |
| `--max-exec-timeout` | | `1h` | The ceiling. A request asking for more is **capped, not refused** |
| `--mcp-path` | | `/mcp` | Where the [MCP endpoint](#remote-mcp) is mounted. Shared by `san remote` and `san remote mcp` |
| `--no-mcp` | | off | Serve the Connect RPCs only |
| `--public-url` | `SAN_REMOTE_PUBLIC_URL` | | The tunnel's URL. **Required when tunnelling** — without it MCP answers 403 to everything |

### The contract

[`proto/san/remote/v1/remote.proto`](../../proto/san/remote/v1/remote.proto) — package
`san.remote.v1`, deliberately **not** under `warehouse/`: it is a tool contract, and nothing the
warehouse serves belongs in it.

| RPC | |
| --- | --- |
| `Info` | The handshake — workspace root, the shell your command will be parsed by, when the token dies. Also the cheapest possible token check |
| `Exec` | Runs one command, `returns (stream ExecResponse)` |
| `FileRead` | One file, byte for byte |
| `FileWrite` | Replaces one file with exactly the bytes given |

`ExecResponse` follows [the long-running-task guideline](../../guidelines/code-implementation-guideline.md):
every frame carries a `message`, and the server's own narration is logged through `slog` bound to
the stream.

| Field | |
| --- | --- |
| `message` | The text of this frame. Forced to valid UTF-8 — proto3 strings must be, and command output is under no such obligation |
| `stream` | `STDOUT` / `STDERR` / `SYSTEM`. SYSTEM is the server talking about the run, not the command talking |
| `result` | **Final frame only** — `exit_code`, `timed_out`, `duration_ms`. Its arrival is how a caller knows the run is over rather than merely quiet |

**A non-zero exit is a RESULT, not an RPC error.** The run happened, and the output of a failing
command is the output a caller most needs. An error comes back only when *nothing ran* — a
`working_dir` outside the root (`invalid_argument`), a shell that will not start (`internal`), a bad
token (`unauthenticated`).

### Files: why `Exec` is not enough

An agent could in principle do everything through the shell. It should not do **files** that way,
and both RPCs exist for one reason: **a shell is a parser, and content is not a program.**

```mermaid
flowchart LR
    A["agent has source containing<br/>a dollar sign and a backtick"] --> B{how does it get there?}
    B -->|"Exec plus a heredoc"| C["a shell PARSES it first"]
    C --> D["the variable is interpolated,<br/>the backtick is eaten,<br/>the line endings are rewritten"]
    D --> E["a file that is not what was sent"]
    B -->|FileWrite| F["the bytes go straight to disk"]
    F --> G["byte-identical"]
```

The same applies coming back: `Exec("cat x.go")` hands the bytes to a program with opinions about
encoding, and on Windows redirection re-encodes on the way past. `FileRead` returns `bytes`, not
`string`, so a fixture, an image, or a file mid-edit survives too — proto3 would reject a `string`
that is not valid UTF-8.

| | |
| --- | --- |
| **Both cap at 8MB** | These move *source*. A file bigger than that is an artefact or a dump, and the error says to use `Exec` and a shell for it |
| **A write REPLACES** | No append, no partial write — a half-applied edit is the failure worth designing out |
| **A write is ATOMIC** | Written to a temp file beside the target and renamed into place. A connection dropped mid-write leaves the **original** intact, not a truncated file — an agent whose network blipped would otherwise corrupt a source file and not find out until the next build |
| **`create_dirs` is off by default** | So a typo in a path fails loudly instead of quietly creating a tree nobody asked for |
| **`replaced` comes back** | The cheapest way for an agent to notice it clobbered something it did not mean to |
| **Same containment as `working_dir`** | One `contain()` shared by every RPC that takes a path — a rule tightened for one cannot be looser for another |

Error codes are the ones an agent can act on, and they are deliberately distinct:

| Code | Means |
| --- | --- |
| `not_found` | The file is not there — *create it* |
| `invalid_argument` | **The caller built the path wrong** — outside the root, absolute, or a directory |
| `permission_denied` | Stop and tell the operator |
| `resource_exhausted` | Over the 8MB cap |
| `internal` | A real filesystem failure. Never a path mistake — an agent that saw `invalid_argument` here would go off rewriting a path that was fine |

---

### What a run actually does

```mermaid
flowchart TD
    A[Exec request] --> B{token valid?}
    B -->|no| Z1[unauthenticated]
    B -->|yes| C{protovalidate}
    C -->|fails| Z2[invalid_argument — the PROTO's rule, not a hand-written if]
    C -->|passes| D{working_dir inside the root?}
    D -->|no| Z2
    D -->|yes| E[audit line on the operator's terminal]
    E --> F[start the shell in its own process group]
    F --> G[stdout and stderr pumped as bytes arrive]
    G --> H{how did it end?}
    H -->|exited| I[final frame — exit code]
    H -->|timeout| J[kill the whole process TREE]
    H -->|caller hung up| K[kill the tree, return canceled]
    J --> I
```

Three things in there are not obvious and each exists because the naive version is wrong:

| | |
| --- | --- |
| **The process TREE is killed, not the shell** | `sh -c "go build ./..."` is a shell whose *child* does the work. Killing the shell alone leaves the compiler running with nothing left to report to. Unix uses a process group, Windows `taskkill /T` |
| **Output is read in fixed-size chunks, not lines** | A `bufio.Scanner` waits for a newline, so a progress bar or a prompt would look frozen until the command finished. A rune the read cut in half is held back for the next one |
| **The deadline hangs off the REQUEST context** | So the command dies both when it overruns *and* when the caller hangs up. An agent that crashes mid-build does not leave the build running |

### Errors you should expect

| Message | Cause |
| --- | --- |
| `unauthenticated: remote: invalid token` | Wrong token, or none. Deliberately the same code for missing, wrong and expired |
| `invalid_argument: working_dir escapes the workspace root: "../.."` | A path climbing out of `--root` |
| `invalid_argument: … command: value length must be at least 1` | The **proto's** `min_len`, applied by the validation interceptor |
| `internal: exec: "sh": executable file not found` | `--shell` names something that is not installed |

---

## `remote mcp`

The Connect RPCs above are for a client **we write**. The MCP endpoint is for the clients we
**don't**: Claude on the web, a browser agent, somebody else's harness. None of those will grow a
hand-written client for a proto contract that lives in this repo — but all of them speak MCP, so
the same four capabilities become reachable with **no code on the far side**.

```sh
# the tunnelled case — MCP and NOTHING else, which is all a hosted agent can use
go run ./tools/san remote mcp --public-url https://devel.example.com

# both faces on one port, for a local agent that also wants the RPCs
go run ./tools/san remote
```

**Which command, and why it matters:**

| | Serves | For |
| --- | --- | --- |
| `san remote mcp` | MCP only — no RPCs, no gRPC reflection | The tunnelled case. That address is deliberately reachable from the internet, and a second unused surface on it is a second surface to get wrong |
| `san remote` | **both**, on one port | A local agent, one server, one tunnel |
| `san remote --no-mcp` | the RPCs only | The mirror image |

MCP is mounted at `/mcp` (`--mcp-path`) either way.

```mermaid
flowchart TB
    subgraph outside["outside — clients we did not write"]
        W["Claude Web"]
        B["Claude Browser"]
        A["other AI agent"]
    end

    URI["https://devel.example.com/mcp"]

    subgraph local["the operator's machine"]
        T["tunnel daemon — cloudflared, ngrok"]
        S["san remote  ·  127.0.0.1:8099"]
        WS[/"the working tree"/]
    end

    W --> URI
    B --> URI
    A --> URI
    URI --> T
    T -->|"Host: devel.example.com, from 127.0.0.1"| S
    S --> WS
```

### The tools

Four, mirroring the four RPCs exactly — the MCP face adds no capability the contract does not
already have.

| Tool | | |
| --- | --- | --- |
| `workspace_info` | read-only | The handshake: root, **which shell**, the timeout ceiling, token expiry, `max_file_bytes` |
| `run_command` | ⚠ destructive | One command, its output, its exit code |
| `read_file` | read-only | One file, byte for byte |
| `write_file` | ⚠ destructive | Replaces one file with exactly these bytes |

**Every tool builds the same proto request the RPC takes and validates it with `protovalidate`
before calling the same handler.** The limits — `min_len` on a command, `max_len` on a path,
`MaxFileBytes`, the timeout ceiling — are therefore read from
[`remote.proto`](../../proto/san/remote/v1/remote.proto) by both faces. A limit re-typed as an `if`
per transport is a limit free to drift, which is the whole reason this is not a second server.

Two places the MCP face necessarily differs from the RPC, and why:

| | RPC | MCP | Why |
| --- | --- | --- | --- |
| Exec output | **streamed**, frame by frame | **buffered**, one result | A tool call has no reader watching. Its result lands in a model's context once, at the end |
| File content | `bytes` | `content` + `encoding` | MCP is JSON and JSON has no bytes. A non-UTF-8 file comes back **base64 with `encoding` saying so** — never silently repaired, because an agent handed replaced bytes would write them back corrupted |

Both go through the **same runner** ([`runner.go`](../../tools/san/remote/runner.go)), so the
process-tree kill, the timeout ceiling and the UTF-8 repair are one implementation with two sinks.

`run_command` output over **128 KB** is truncated **in the middle** — the head holds the first
error, usually the only real one, and the tail holds the verdict. `truncated` and `dropped_bytes`
say so, and the gap is marked in the text rather than being silently absent.

### Connecting a client

Two shapes, and the client decides which you need.

**A client that can send headers** — Claude Code, Claude Desktop, Cursor. This is the right one
whenever it is available:

```json
{
  "mcpServers": {
    "san-remote": {
      "type": "http",
      "url": "http://127.0.0.1:8099/mcp",
      "headers": { "Authorization": "Bearer <the token from the banner>" }
    }
  }
}
```

**A client with only a URL box** — a hosted connector, where there is nowhere to type a header. The
token becomes a **path segment**:

```
https://devel.example.com/mcp/<the token from the banner>
```

> ⚠ **A token in a URL is genuinely weaker.** It lands in browser history, in your tunnel
> provider's access log, and in any screenshot of the settings screen it was pasted into — and
> whoever reads it has a shell on your machine. It is acceptable here only because the credential
> is minted per run and dies when you press Ctrl-C. Use `--token-ttl` to bound it further, and
> prefer the header form whenever the client supports it.

The header **wins** when both are present, so a stale token in a bookmarked URL cannot lock out a
client that is sending the right one.

### Putting a tunnel in front

⚠ **`--public-url` is required when you tunnel.** Without it every MCP request is refused with
**403**, and nothing in the error says why.

```sh
# terminal 1 — the server, told that a tunnel is in front of it
go run ./tools/san remote --public-url https://devel.example.com

# terminal 2 — the tunnel
cloudflared tunnel --url http://127.0.0.1:8099        # or: ngrok http 8099
```

The reason is worth knowing, because the symptom is so unhelpful. The MCP SDK carries a
**DNS-rebinding guard**: a request that *arrives on loopback* while carrying a *non-loopback `Host`
header* is rejected. That is exactly the shape of every tunnelled request — `cloudflared` connects
to `127.0.0.1` and forwards `Host: devel.example.com`. The guard is right for a server only ever
spoken to locally and wrong for the one case this endpoint exists to serve, so **the operator
declares which they are running** rather than the server guessing from a header any caller can set.

The banner prints both URLs, and warns when no public URL was given:

```
  mcp        http://127.0.0.1:8099/mcp
             ↳ with a header:  Authorization: Bearer cjcVOGn-sVONkQzIvgVRWzjcMjQl1q_QtJYxzKmZNG0
             ↳ url only:       https://devel.example.com/mcp/cjcVOGn-sVONkQzIvgVRWzjcMjQl1q_QtJYxzKmZNG0
```

### Errors you should expect

| Symptom | Cause |
| --- | --- |
| `401` + `WWW-Authenticate: Bearer` | No token, wrong token, or an expired one. Same answer for all three |
| `403` on **every** request, through a tunnel | `--public-url` was not given — see above |
| `404` on `/mcp/<token>/something` | A deeper path is not a token with extra segments, and is refused |
| A tool result with `isError` and a readable message | The **tool** failed — a bad path, an unknown `encoding`, a value the proto refuses. Deliberately a tool error rather than a protocol one, so the model can see it and fix it |
| `413` | The request body exceeded the transport cap, which is set **above** `MaxFileBytes` plus base64 overhead so a legal `write_file` never hits it first |

---

## `remote refresh-token`

Moves the stored token's **deadline**, not the token.

```sh
go run ./tools/san remote refresh-token                  # +30 days, same token
go run ./tools/san remote refresh-token --token-ttl 2160h  # +90 days
go run ./tools/san remote refresh-token --rotate         # a NEW token — for a leak
```

```
san remote refresh-token — D:\pdcgo\warehouse_revamp\.san\remote-token.json
  token      rIqPy30KBQSrQsqcqwsKk72Dk7aQG_U1WAUI2rMsLUU
  expires    2026-11-18T17:24:51+07:00
             ↳ was 2026-09-19T17:24:51+07:00
  unchanged  every client holding this token keeps working
```

**Why extending beats rotating.** Rotation is the easy operation — mint, overwrite, done — but it
costs a trip to every client's settings screen, and the token most likely to reach its deadline is
the one pasted into a connector *precisely because* nobody wants to go back there. A refresh keeps
the credential and moves only the date, so there is nothing to re-paste.

| | |
| --- | --- |
| `--rotate` | A new value. The answer to a **leak**, not to a deadline — every client holding the old one must be re-pasted |
| `--token-ttl` | How far out to push it. Same default as a server start: **30 days** |
| `--token-store`, `--root` | The same [store](#persistence-and-rotation) the server reads |
| An **expired** token | Extended anyway, and the output says it was revived. Lapsing is the ordinary reason to run this, and refusing would leave rotation as the only cure for the case rotation is least wanted |
| An **unreadable** store | Reported, never overwritten. Unlike a server start there is nothing here that must keep running, so a mangled file is left for you to look at |
| `--no-persist-token` | Refused — there is no stored token to refresh |

⚠ **A server that is already running does not pick this up.** It read the store when it started and
holds that deadline in memory, so restart it for the new expiry to take effect. The command says so
every time.

```mermaid
sequenceDiagram
    actor Op as Operator
    participant CLI as san remote refresh-token
    participant Store as .san/remote-token.json
    participant Srv as a running san remote

    Op->>CLI: refresh-token
    CLI->>Store: read the value, ignoring its expiry
    alt --rotate
        CLI->>CLI: mint a new value
    else the ordinary case
        Note over CLI: the value is kept as it is
    end
    CLI->>Store: write — same value, expiry = now + ttl
    CLI-->>Op: token, new expiry, what changed
    Note over Srv: still serving the OLD deadline from memory
    Op->>Srv: Ctrl-C and start it again
    Srv->>Store: read
    Note over Srv,Store: now the refreshed deadline is in force
```

**Why this is a CLI command and not an RPC.** The caller here is an operator at a terminal. Exposed
over HTTP it would let anything holding the token renew its own access indefinitely, which turns a
30-day credential into a permanent one for exactly the caller you would least want to grant that to.

## `remote exec`

The client — one command, streamed, **exiting with the remote command's own status**. It exists so
a server can be checked by hand, and as a reference consumer of the streaming contract: an agent
writing its own client can read [`remote_exec.go`](../../tools/san/remote_exec.go) and see exactly
which frames matter.

```sh
export SAN_REMOTE_TOKEN=…                       # the token the server printed

go run ./tools/san remote exec --info           # the handshake
go run ./tools/san remote exec -- "go build ./..."
go run ./tools/san remote exec --dir backend -- "go test ./..."
```

| Flag | Env | Default | |
| --- | --- | --- | --- |
| `--url` | | `http://127.0.0.1:8099` | Base URL of the server |
| `--token` | `SAN_REMOTE_TOKEN` | | Required |
| `--dir` | | the root | Relative to the server's workspace root |
| `--timeout` | | the server's own | |
| `--info` | | | Print `Info` and run nothing |

stdout goes to stdout, stderr to stderr, and the server's narration to stderr with a **`san:`**
prefix so a script parsing the output can never mistake it for the command's own. The exit status is
the remote command's, and **124** means it timed out — the same convention `timeout(1)` uses.

> ⚠ Under `go run` the status is masked: `go run` prints `exit status 7` and exits **1** itself.
> Build the binary if a script needs to branch on the code.

---

## `remote get` · `remote put`

The file half of the client. Both move **raw bytes** through stdout/stdin, so a redirect produces
an identical copy — every message they print of their own goes to **stderr** for that reason.

```sh
export SAN_REMOTE_TOKEN=…

go run ./tools/san remote get src/main.go                    # bytes to stdout
go run ./tools/san remote get src/main.go --out ./local.go

go run ./tools/san remote put src/main.go --from ./local.go --create-dirs
echo "package main" | go run ./tools/san remote put src/main.go
```

| Flag | | |
| --- | --- | --- |
| `--url` | both | Base URL of the server (`http://127.0.0.1:8099`) |
| `--token` / `SAN_REMOTE_TOKEN` | both | Required |
| `--out` | `get` | Write to this local file instead of stdout |
| `--from` | `put` | Local file to send. Omitted = read stdin |
| `--create-dirs` | `put` | Create missing parent directories on the server |

---

## `deploy`

Ship **one service** to Cloud Run: Cloud Build compiles its own entry point from source, and Cloud Run serves it
([san-deploy-ships-one-service-to-cloud-run](../technical/development/workflow_decision.md#san-deploy-ships-one-service-to-cloud-run)).

```sh
go run ./tools/san deploy                                   # pick the service, check, confirm, deploy
go run ./tools/san deploy --service shipment_service
go run ./tools/san deploy --service shipment_service --dry-run   # the plan and the gcloud commands; runs nothing
```

> ⚠ **This acts on production.** It shows the whole plan, checks it, and makes you type `production` before
> anything is built.

**Deployable today: `shipment_service` only** — the one service with an entry point of its own
([backend/cmd/shipment_service](../../backend/cmd/shipment_service/)). Every other service still runs only inside
the dev server, which mounts them all.

| service | entry point | Cloud Run service | secrets (env ← Secret Manager, `:latest`) |
| --- | --- | --- | --- |
| `shipment_service` | `./backend/cmd/shipment_service` | `revamp-shipment-service` | `DATABASE_URL` ← `revamp-database-url` · `JWT_SECRET` ← `revamp-jwt-secret` |

```mermaid
flowchart TD
    P["pick the service"] --> T["project and region: flags, else the active gcloud config"]
    T --> G{"uncommitted changes?"}
    G -->|"yes, no --allow-dirty"| X["refuse"]
    G -->|"no, or --allow-dirty"| S["print the plan"]
    S --> D{"--dry-run?"}
    D -->|"yes"| C["print the gcloud commands, stop"]
    D -->|"no"| F["preflight: every secret exists, and the Cloud Run service is ours"]
    F --> Y["type production"]
    Y --> B["gcloud run deploy --source . — Cloud Build compiles backend/cmd/service"]
    B --> H["GET the new URL /healthz"]
```

### What it does

1. **Picks the service** — `--service`, or a picker. A service with no entry point of its own is refused by name.
2. **Reads the target** — `--project` / `SAN_DEPLOY_PROJECT` and `--region` / `SAN_DEPLOY_REGION`, else the active
   gcloud config (`gcloud config get-value project`, `run/region`). Nothing about the target is written in this
   repository: it is public.
3. **Refuses a dirty tree** unless `--allow-dirty`. `--source .` uploads the **working tree**, so a dirty deploy runs
   code no commit holds; with the flag the revision is labelled `<commit>-dirty`.
4. **Prints the plan**, then with `--dry-run` the exact gcloud commands, and stops there.
5. **Preflight**, before the confirmation:
   - every secret in the service's row exists (`gcloud secrets describe`) — all missing ones named at once;
   - the Cloud Run service is **ours**: it does not exist yet, or carries the label `app=warehouse-revamp`. The
     project is **shared with other systems**, a deploy replaces the service it names, so a same-named service
     without our label is refused.
6. **Confirms** — type `production` (the same guard `san_dbtarget` puts on every database command).
7. **Deploys** — `gcloud run deploy <name> --source=.` with buildpacks: `GOOGLE_BUILDABLE` is the service's entry
   point, `GOOGLE_GO_VERSION` is go.mod's `go` line (not the buildpack's "latest"). The secrets are mapped to env
   by `--set-secrets`, the revision labelled `app`, `service`, `commit`. gcloud runs on san's console, so it may
   ask to create the `cloud-run-source-deploy` repository or enable an API on a first run.
8. **Checks** `GET <url>/healthz` and prints the URL. A deploy that already succeeded is not failed by this.

**What goes up** is decided by [.gcloudignore](../../.gcloudignore) — a whitelist of `go.mod`, `go.sum` and
`backend/` (no binaries, no test files, no PDFs, no `examples/` — nothing the build does not read). Check the list
with `gcloud meta list-files-for-upload` (≈ 830 files, ≈ 10 MB).

### Flags

| Flag | Env | |
| --- | --- | --- |
| `--service` | | the service; omitted = a picker |
| `--project` | `SAN_DEPLOY_PROJECT` | default: the gcloud config's `project` |
| `--region` | `SAN_DEPLOY_REGION` | default: the gcloud config's `run/region` |
| `--cloudsql-instance` | `SAN_DEPLOY_CLOUDSQL_INSTANCE` | `project:region:instance`, mounted at `/cloudsql/<it>` — the DSN in the secret then uses `host=/cloudsql/<it>` |
| `--allowed-origins` | `SAN_DEPLOY_ALLOWED_ORIGINS` | comma-separated CORS origins (`ALLOWED_ORIGINS`). Omitted = left as deployed |
| `--allow-dirty` | | deploy uncommitted changes, labelled `<commit>-dirty` |
| `--dry-run` | | the plan and the commands; nothing runs, nothing is asked |

### What it does NOT do

- **Migrate.** Migrations stay their own manual step (owner, 2026-11-03): run
  `go run ./tools/san migrate up --service shipment_service` against that database first — and **user_service**'s,
  because the access interceptor reads `user_team_roles` from the same database.
- **Create secrets or grant IAM.** Once, per project:
  `gcloud secrets create revamp-database-url --data-file=-` (and `revamp-jwt-secret`), and the Cloud Run runtime
  service account needs *Secret Manager Secret Accessor* and, for the socket, *Cloud SQL Client*.
- **Touch a database.** It never asks Local/Production, and `--dsn` means nothing to it.

### The deployed service

`backend/cmd/shipment_service` is shipment_service **alone** — `ShipmentChannelService` and `ReceiptService` behind
the dev server's own chain (protovalidate, then the access interceptor), on `PORT` (Cloud Run's), `/healthz` for
the probe. Run it locally with `go run ./backend/cmd/shipment_service` (`:8090`, the docker-compose database).

- **It refuses to start on Cloud Run with a dev default** for `JWT_SECRET` or `DATABASE_URL` (`K_SERVICE` set): a
  missing secret would otherwise make every signed-in call Unauthenticated. Cloud Run keeps the old revision.
- **`JWT_SECRET` must be user_service's**: this service verifies tokens it does not mint.
- ⚠ **No sign-in is deployed yet.** The channel reads are public and work; the label check and the channel writes
  need a token from user_service, which still runs only in the dev server.
- ⚠ **No agent verifier, no team kinds**: an AI-agent bearer (`wha_…`) answers Unauthenticated here.
- ⚠ **Cache is in-process** unless `REDIS_ADDR` is set: with more than one instance, a revoked role stays cached on
  the others until its TTL lapses. `ReceiptCheck`'s two-at-once limit is per instance too.

### Errors you should expect

| Message | Meaning |
| --- | --- |
| `the working tree has uncommitted changes` | commit, or `--allow-dirty` |
| `"x" cannot be deployed — deployable: …` | that service has no entry point of its own yet |
| `gcloud is not on PATH` | install the Google Cloud CLI, `gcloud auth login` |
| `no project` / `no region` | pass the flag, or set it in the gcloud config |
| `secrets missing (or not readable) in <project>: …` | create them — or the account lacks access |
| `the Cloud Run service … is NOT labelled app=warehouse-revamp` | a same-named service belongs to something else; refused |
| `deployed with a dev default for JWT_SECRET` (in Cloud Run's log) | the revision would not start; check the secret mapping |

---

## Adding a command

```mermaid
flowchart TD
    A["a new file in tools/san/<group>_<verb>.go"] --> B["a cli.Command — flags, Usage, Description"]
    B --> C["a METHOD on *San that calls the service handler"]
    C --> D["protovalidate.Validate before the handler"]
    D --> E["a unit test beside it, on san_testdb"]
    E --> F["a row in the Commands table of THIS file, same commit"]
    C -.->|"needs a new dependency"| W["add the provider to wire.go, then go tool wire ./tools/san"]
```

The rules, and why each exists:

| Rule | Why |
| --- | --- |
| **Drive the service, never the table.** A command calls an RPC handler through `*San`. | An operation is rarely one statement — a password reset is three. A hand-written `UPDATE` is a second copy of that sequence, free to fall behind the first. |
| **`protovalidate.Validate` the request first.** | A handler called directly gets **no validation interceptor**. Re-typing the constraint as an `if len(…) < 8` creates a second minimum that can drift from the proto. |
| **Wire, never hand-wiring** — [`wire.go`](../../tools/san/wire.go), then `go tool wire ./tools/san`. | Same rule as the server (HARD RULE 4). `wire_gen.go` is generated and never hand-edited. |
| **The DSN stays an injector parameter.** | Which database to act on is a per-invocation, guarded, interactive choice. A provider reading it from config would hide that. |
| **Resolve the target through `san_dbtarget`.** | The `type "production" to continue` guard is shared with `cmd/tool` so it cannot protect one CLI and not the other. |
| **A unit test beside the command**, on `san_testdb`. | Same bar as an RPC. Build the `San` directly in the test — Wire would open its own pool and escape the rollback. |
| **Document it here, in the same commit.** | A CLI whose commands are only discoverable by reading `main.go` is a CLI nobody uses. |

Prompt for anything destructive and irreversible, and prefer prompting for a secret over taking it
as a flag — an argument is recorded in shell history and readable from the process list.

### Two shapes, and which rules apply

Those rules are about a command that **acts on data**. [`remote`](#remote) does not, and applying
them to it would be cargo cult — so be explicit about which shape a new command is:

| | a **data** command (`user reset-password`) | a **machine** command (`remote`) |
| --- | --- | --- |
| Picks a database | yes, through `san_dbtarget` | **no** — it would ask a question with no bearing on what happens |
| Goes through `withSan` / Wire | yes — the graph IS "the services for the chosen database" | no; its one dependency is a config built from flags |
| `protovalidate` | before calling the handler by hand | done by the **validation interceptor**, because it really is served over RPC |
| Test harness | `san_testdb`, per-test transaction | a real server + the generated client, so the interceptor is tested too |

[`dev run`](#dev-run) is a machine command that serves nothing, so it has no request to validate. Its
tests start **the test binary itself** as the child processes, so they need no go, npm or docker. A
kill that misses a child shows up as a test that never returns.

[`dev setup`](#dev-setup) is neither shape. It acts on data but never picks a database (it is local
by construction), and it calls the data commands' own functions instead of a service handler. Its
test creates a **throwaway database** and runs every data step twice against it, which proves the
re-run is safe. It cannot use `san_testdb`, because migrations do not run inside the per-test
transaction.

What does **not** change either way: a unit test beside the file, and a row in the Commands table of
this document in the same commit.

---

## Where the code is

| File | |
| --- | --- |
| [`main.go`](../../tools/san/main.go) | the root command and `--dsn` |
| [`san.go`](../../tools/san/san.go) | `San` — what every command is handed — and `withSan` |
| [`wire.go`](../../tools/san/wire.go) | the composition root (`wire_gen.go` is generated) |
| [`deps.go`](../../tools/san/deps.go) | the providers: db, cache, signer, role resolver, the team and document clients `user_v1` is built with, and an event sender that validates and drops — san removes no member, so it announces nothing |
| [`config.go`](../../tools/san/config.go) | env/yaml configuration |
| [`user.go`](../../tools/san/user.go) | the `user` group and the account selector |
| [`user_reset_password.go`](../../tools/san/user_reset_password.go) | the command |
| [`remote.go`](../../tools/san/remote.go) | the `remote` group, the serve command, the token banner |
| [`remote_exec.go`](../../tools/san/remote_exec.go) | the `remote exec` client |
| [`remote_file.go`](../../tools/san/remote_file.go) | the `remote get` / `remote put` clients, and the shared authenticated client |
| [`remote/`](../../tools/san/remote/) | the service: `exec.go`, `info.go`, `file_read.go`, `file_write.go`, `auth.go`, `workspace.go`, `shell.go`, one test per file |
| [`dev.go`](../../tools/san/dev.go) | the `dev` group, and what both commands share: `--no-docker`, `docker compose up`, running one step |
| [`dev_setup.go`](../../tools/san/dev_setup.go) | `dev setup`: the local-only guard, the submodule check, the data steps in order |
| [`dev_run.go`](../../tools/san/dev_run.go) | `dev run`: the stack, the supervisor, the line prefixer |
| [`proctree/`](../../tools/san/proctree/) | start a child in its own group, kill its whole tree. Shared by `remote`, `dev run` and `test` |
| [`test.go`](../../tools/san/test.go) | the `test` group and its six commands' flags |
| [`test_fingerprint.go`](../../tools/san/test_fingerprint.go) | the fingerprint: what is walked, what is skipped, the diff |
| [`test_measure.go`](../../tools/san/test_measure.go) | areas, risk, the wide-change list, due/overdue, the one-line ask |
| [`test_proto.go`](../../tools/san/test_proto.go) | the small `.proto` reader (field made required, `request_policy`, event contents) and the migration reader |
| [`test_affected.go`](../../tools/san/test_affected.go) | the affected-spec finder: the frontend import graph by name, routes, test ids, RPC callers, the Go name graph, `affected.txt` |
| [`test_smoke.go`](../../tools/san/test_smoke.go) | `smoke.txt`, its `--grep`, the level-2 runner |
| [`test_full.go`](../../tools/san/test_full.go) | the frozen copy, the full run, moving `last_green.json` |
| [`test_runner.go`](../../tools/san/test_runner.go) | batches and caps, ports and locks, running Playwright/vitest/go test, reading their reports |
| [`test_report.go`](../../tools/san/test_report.go) | `e2e_report/`: run records, `latest.md`, the slice log |
| [`frontend/e2e/smoke.txt`](../../frontend/e2e/smoke.txt) · [`affected.txt`](../../frontend/e2e/affected.txt) | the smoke set, and the finder's mapping |
| [`deploy.go`](../../tools/san/deploy.go) | `deploy`: the deployable services, the plan, the preflight, the gcloud calls |
| [`backend/cmd/shipment_service`](../../backend/cmd/shipment_service/) | the entry point `deploy` builds for shipment_service — its own Wire, config and chain |
| [`.gcloudignore`](../../.gcloudignore) | what `deploy` uploads: `go.mod`, `go.sum`, `backend/` |
| [`pkgs/san_dbtarget`](../../backend/pkgs/san_dbtarget/) | the Local/Production choice, shared with `cmd/tool` |
| [`pkgs/san_dbsession`](../../backend/pkgs/san_dbsession/) | opens every handle — `NewDatabase` and `openDatabase` — with the session on **Jakarta time** (`TimeZone=Asia/Jakarta`, [the-system-runs-on-jakarta-time](../technical/architecture/context_decision.md#the-system-runs-on-jakarta-time)), the server's and the tests' calendar |
| [`report.go`](../../tools/san/report.go) | `report refold` — the shop and the person report, through settlement_service's `DayRefold` |

**`remote/` is a Connect service that deliberately does NOT live in `backend/services/`.** Every
warehouse service does, and is mounted into the application mux by `service_api.go` — this one must
never be, because a shell belongs nowhere near the process serving customers. Keeping it inside the
operations tool makes that structural instead of a rule somebody has to remember: mounting it on the
app would take an import from `backend/` up into `tools/`, which is exactly the kind of line that
stops a reviewer.

A top-level directory can import `backend/…` because the **Go module is rooted at the repository**
(`module github.com/pdcgo/warehouse_revamp`) — one module covering both trees, so `san` needs no
`go.mod` and no `replace` of its own. The consequence to remember: `go build|vet|test ./...` belongs
at the root, since running it inside `backend/` skips this tool entirely.
