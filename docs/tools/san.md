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

## One CLI, four jobs

`san` covers the whole life of the project's data and the environment around it.

| | Commands | |
| --- | --- | --- |
| **the schema** | [`migrate`](#migrate) | goose, per service (HARD RULE 3) |
| **the fixtures** | [`seed`](#seed) · [`db`](#db) · [`region`](#region) | dev data, the test database, reference data |
| **operations** | [`user reset-password`](#user-reset-password) | acts on real data, through the real services |
| **the workspace** | [`remote`](#remote) · [`remote mcp`](#remote-mcp) · [`remote refresh-token`](#remote-refresh-token) | serve this checkout to a coding agent |

```mermaid
flowchart LR
    subgraph san["tools/san — one binary"]
        M["migrate"]
        S["seed · db · region"]
        U["user reset-password"]
        R["remote · remote mcp · refresh-token"]
    end
    M -->|"shapes the schema"| DB[(Postgres)]
    S -->|"puts rows in it"| DB
    U -->|"changes what is IN it, through the services"| DB
    R -->|"runs shell commands in the checkout"| WS[/"the working tree"/]
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
| [`user reset-password`](#user-reset-password) | Set a user's password without knowing the old one |
| [`pubsub ensure`](#pubsub-ensure) | Make every declared event topic and subscription exist, with the safe defaults |
| [`pubsub redrive`](#pubsub-redrive) | Re-publish everything sitting in a dead-letter queue back to its topic |
| [`remote`](#remote) | Serve this checkout to a coding agent — shell commands, streamed, behind a bearer token kept per workspace |
| [`remote mcp`](#remote-mcp) | Serve this checkout as **MCP tools** — the command for Claude Web and any other client we did not write, behind a tunnel |
| [`remote refresh-token`](#remote-refresh-token) | Push the stored token's deadline out — same token, so nothing has to be re-pasted |
| [`remote exec`](#remote-exec) | The client: run one command on a `remote` server and stream its output |
| [`remote get` · `remote put`](#remote-get--remote-put) | The client: move a file to or from the server, byte for byte |

*(Every new one is added to this table — see [Adding a command](#adding-a-command).)*

**`remote` and `pubsub` touch no database**, so they never ask Local/Production and need no Postgres
running. `--dsn` is meaningless to both. `pubsub` has its own target flags instead — `--project`, and
`--emulator` for the local broker.

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
| `--service` / `-s` | Which service. **Prompts when omitted.** Discovered from the filesystem, so the list never goes stale |
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
produces a role pointing at a team that does not exist yet.

### Errors you should expect

| Message | Cause |
| --- | --- |
| `unknown service "x" — have: [...]` | Typo. The list is the filesystem, so anything missing from it does not exist |
| `not inside a warehouse_revamp checkout: no go.mod beside backend/services …` | Run from outside the repo |
| `a goose command is required (up, down, status, create, ...)` | `san migrate` with no goose verb |
| `create needs a name: migrate create <name> --service <svc>` | `create` with no migration name |

---

## `seed`

Development fixtures. **Never production data**, and deliberately not a migration — a migration runs
everywhere, including production, and anything inside one *will* eventually execute there.

```sh
go run ./tools/san seed root --password <secret>   # the root account, nothing else
go run ./tools/san seed dev  --password <secret>   # teams + several accounts (development)
go run ./tools/san seed categories                 # the product taxonomy
go run ./tools/san seed categories -f other.json
```

| Sub-command | | |
| --- | --- | --- |
| `root` | Sets the root account's password | The migration creates root with an **empty** password, which bcrypt can never match — so the account exists and cannot log in until this runs. That is the point |
| `dev` | Teams and several logins | Development only |
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
```

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

## `pubsub ensure`

```sh
# dev, against the local emulator (docker compose --profile pubsub up -d)
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
    P-->>S: order-placed, order-cancelled
    S->>G: topic + 31-day retention
    S->>G: topic.dlq
    S->>G: topic.dlq.triage — never expires
    S->>G: each declared subscription, every default
    G-->>S: one already exists and its filter differs
    S-->>S: REFUSE, naming the subscription and the field
```

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

It is also what makes streaming work at all. The
[access interceptor](../../backend/services/user_service/access_interceptors/) **refuses every
streaming RPC**, because it reads its team scope from the request **body**, which has not arrived
when an interceptor runs. A bearer token is a **header** — it is there before the first message — so
`remote`'s own interceptor guards unary and streaming calls alike.

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

What does **not** change either way: a unit test beside the file, and a row in the Commands table of
this document in the same commit.

---

## Where the code is

| File | |
| --- | --- |
| [`main.go`](../../tools/san/main.go) | the root command and `--dsn` |
| [`san.go`](../../tools/san/san.go) | `San` — what every command is handed — and `withSan` |
| [`wire.go`](../../tools/san/wire.go) | the composition root (`wire_gen.go` is generated) |
| [`deps.go`](../../tools/san/deps.go) | the providers: db, cache, signer, role resolver |
| [`config.go`](../../tools/san/config.go) | env/yaml configuration |
| [`user.go`](../../tools/san/user.go) | the `user` group and the account selector |
| [`user_reset_password.go`](../../tools/san/user_reset_password.go) | the command |
| [`remote.go`](../../tools/san/remote.go) | the `remote` group, the serve command, the token banner |
| [`remote_exec.go`](../../tools/san/remote_exec.go) | the `remote exec` client |
| [`remote_file.go`](../../tools/san/remote_file.go) | the `remote get` / `remote put` clients, and the shared authenticated client |
| [`remote/`](../../tools/san/remote/) | the service: `exec.go`, `info.go`, `file_read.go`, `file_write.go`, `auth.go`, `workspace.go`, `shell.go`, one test per file |
| [`pkgs/san_dbtarget`](../../backend/pkgs/san_dbtarget/) | the Local/Production choice, shared with `cmd/tool` |

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
