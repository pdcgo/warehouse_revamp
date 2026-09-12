# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

`warehouse_revamp` is a **new warehouse system, built from scratch**. Not a refactor, not a
port, not a migration.

It is at the **design stage** — almost nothing is decided. The business truth is
**[docs/business/](docs/business/)** and the technical truth is **[docs/technical/](docs/technical/)**
— both owner-written. How a requirement becomes working software is
**[docs/development_lifecycle.md](docs/development_lifecycle.md)**. Read them before proposing
anything.

> **This repository is PUBLIC.** Keep credentials, secrets, and the names of unrelated internal
> systems out of anything committed — code, comments, docs, and commit messages alike.

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
tools/san/                   the OPERATIONS CLI — top-level, acts on real data (HARD RULE 3b)
backend/
  cmd/app_development/       the dev server — wires services into the mux
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

**Performance-audit each RPC once it's implemented.** (owner) A working RPC is not a finished
one — measure its latency, its query count and its query plans before moving on. The procedure,
the thresholds and the report template are the **`audit-rpc-performance` skill**; the probe is
[backend/pkgs/san_perf/](backend/pkgs/san_perf/). **Only a HEAVY result gets written up** —
`audits/services/<service_name>/performances/<RpcName>.md`, each finding carrying its own fix
recommendation for later discussion. A fast RPC produces a one-line answer and no file, so
`audits/` stays a list of problems rather than a log. The audit **never applies the fix** — the
report is input to a discussion, and an index migration belongs to the owning service and the
owner's decision (HARD RULE 3, HARD RULE 8).

**Concurrency-audit each WRITE RPC too — fast is not the same as correct.** The people using this
system work in pairs on one stock level, so two callers at the same second is the normal case. The
procedure is the **`audit-sql` skill**; the harness is [backend/pkgs/san_race/](backend/pkgs/san_race/).
Same rules as the performance audit: only an UNSAFE result is written up
(`audits/services/<service_name>/concurrency/<RpcName>.md`), and it never applies the fix.

> ⚠ A concurrency test **cannot** use `san_testdb.DB(t)` — that is one transaction, and two
> goroutines inside one transaction never block on each other's locks, never deadlock, and never
> lose an update. It uses `san_testdb.Pool` through `san_race.New`, and is build-tagged `raceaudit`
> so a committing test never runs beside the rolling-back ones.

**Tests use a SEPARATE database — never the dev one.** All automated tests run against
`warehouse_test`, never the development database (`postgres`) the owner reviews on: same Postgres
instance (`:5433`), a different database, so a test run can never read or corrupt review data.
`san_testdb` creates `warehouse_test` on demand and rolls back per test; the e2e resets it fresh
each run and drops it after (`go run ./tools/san db reset-test|drop-test`), and runs its own API/UI
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
- **A mermaid diagram must PARSE — run `npm run lint:mermaid` after writing one.** (owner, #152)
  Characters that are ordinary in prose are syntax to mermaid, and the worst of them is **`;`**: in a
  `sequenceDiagram` message or `Note` it ends the statement, and the whole diagram renders as an error
  box instead of a picture. A broken diagram is invisible in review — the markdown looks fine in the
  diff — so it is checked, not eyeballed.
  - **Do not grep for the dangerous characters; parse the diagram.** Whether `;` breaks anything
    depends on where it sits: inside a QUOTED `erDiagram` comment it is harmless, in a sequence
    message it is fatal. When this check was introduced, a grep flagged 24 lines of which 5 were real,
    and it missed a broken `subgraph` title that contained no semicolon at all.
  - In sequence messages and notes, use **`—`** or **`,`** where you would naturally write `;`.
  - A `subgraph` title containing punctuation (`—`, `§`, `(`) must be **quoted**:
    `subgraph "warehouse side — undesigned §1"`.
- **Document every schema change.** A migration that changes the schema updates
  [docs/database-schema.md](docs/database-schema.md) **in the same commit** — one section per
  service, each with a **mermaid** `erDiagram` of the tables and their relations. The migrations
  are authoritative; the doc mirrors them for humans and must not drift.
- **Document complex / cross-service RPC flows.** Any RPC with a non-trivial flow (multi-step,
  saga, compensation) or a dependency on another service goes in
  `docs/services/<service_name>/rpc.md`, with a **mermaid** sequence/flow diagram. Update it in the
  same commit as any refactor, flow change, or code change that touches the flow — the doc must not
  drift. Simple single-table CRUD RPCs do not need an entry.

Migrations are driven by the **unified CLI** at [tools/san/](tools/san/) (`urfave/cli/v3`, HARD
RULE 3b). It finds the checkout by walking up from your working directory, so it runs from
anywhere in the repo:

```sh
go run ./tools/san migrate create add_users --service user_service   # writes a .sql file, no DB
go run ./tools/san migrate up                                        # prompts: database, then service
go run ./tools/san migrate status --service user_service
```

Run interactively and it asks **two things, in this order**: which **database**
(`Database Local` / `Database Production`), then which **service**. Selecting Production
additionally requires typing `production` to confirm — a `migrate down` on prod must not be one
arrow-key away from a local one.

- `--service <name>` skips the service prompt. Services are **discovered from the filesystem**
  (`backend/services/*`) — there is no hardcoded list to go stale.
- `migrate up-all` migrates **every** service, in dependency order (`team_service` then
  `user_service` first — team 1 must exist before the root role references it), asking only for
  the database. That is the one-command path for a fresh database.
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

### 3b. `tools/san` is THE CLI — one binary for schema, fixtures, operations and the workspace

**One tool, not two** (owner, `docs/technical/development/level.md`). [tools/san/](tools/san/)
owns the **schema** (`migrate`), the **fixtures** (`seed`, `db`, `region`), the **actions an
operator performs on real data** (`user reset-password`), and **serving the checkout to a coding
agent** (`remote`, `remote mcp`).

> ⚠ **`backend/cmd/tool` is GONE.** It held migrate/seed/db/region and was split from `san` on the
> argument that a developer's tool and an operator's tool are used at different moments by different
> people. That is true of the COMMANDS and was never true of the BINARY — and the split had no seat
> for `deploy` at all. Anything still saying `go run ./cmd/tool …` is stale; the command is
> `go run ./tools/san …`.

What the merge does **not** collapse is the guard rails: every command that touches a database
resolves it through [backend/pkgs/san_dbtarget/](backend/pkgs/san_dbtarget/), so the Local/Production
prompt and the `type "production" to continue` confirmation protect all of them.

⚠ **`san db` uses `--admin-dsn`, not `--dsn`.** It creates and drops the test database, which needs
a connection to a DIFFERENT database — and the root `--dsn` reads `DATABASE_URL`, which during a
test run points at the very database being dropped. The flag was renamed when the two CLIs merged,
because until then there was no root flag to collide with.

**It lives at the REPO ROOT, not under `backend/`** (owner). It is not a part of the server: it is
the tool a human reaches for when something has to be done to a running system, and it should read
that way in the tree. Run it from the root:

```sh
go run ./tools/san user reset-password --username ani        # prompts for the password, twice, hidden
go run ./tools/san user reset-password --user-id 57 --dsn …  # non-interactive
```

> The Go module is rooted at the **repository** (`module github.com/pdcgo/warehouse_revamp`), which
> is what lets a top-level tool import `backend/…` without a second module and a `replace`. Import
> paths are unchanged by that — the packages still live under `backend/`, so
> `github.com/pdcgo/warehouse_revamp/backend/pkgs/…` resolves exactly as before.
>
> ⚠ **`go build|vet|test ./...` belongs at the ROOT now.** Run from `backend/` it still works, but
> it covers only the server subtree and silently skips `tools/`.

- **A command calls the RPC handler, never a hand-written `UPDATE`.** Setting a password is a
  hash *plus* a `last_password_reset` stamp (which kills the account's existing tokens) *plus* a
  cache eviction. A second copy of that sequence is a copy that falls behind the first — which is
  exactly what `san seed root`'s raw UPDATE already is.
- **It is wired with Google Wire** ([tools/san/wire.go](tools/san/wire.go)), same
  rule as HARD RULE 4 — `go tool wire ./tools/san`. The **DSN is an injector parameter**, not a
  provider: which database to act on is an operator's per-invocation choice.
- **The Local/Production prompt is shared**, not copied —
  [backend/pkgs/san_dbtarget/](backend/pkgs/san_dbtarget/) serves both CLIs, so the "type
  `production` to continue" guard cannot exist in one and not the other.
- **A handler called directly gets no validation interceptor**, so a command validates the request
  with `protovalidate.Validate` before calling it. Never re-type the constraint as an `if`.
- **Every change to the tool updates [docs/tools/san.md](docs/tools/san.md) in the same commit** —
  a new command gets a row in its Commands table and its own section (flags, a mermaid sequence of
  what the command actually does, and the errors it can return). A CLI whose commands are only
  discoverable by reading `main.go` is a CLI nobody uses. Same rule as a schema change updating
  `docs/database-schema.md`.

The general service guideline lives in
[guidelines/service-guideline.md](guidelines/service-guideline.md) — it is programmer-authoritative
(RULE 7); treat it as such and keep this section in sync with it.

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

CLI entrypoints use **`urfave/cli/v3`** (`cmd/app_development`, `tools/san`).

`tools/san` has its own composition root ([tools/san/wire.go](tools/san/wire.go),
`go tool wire ./tools/san`) — see HARD RULE 3b.

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

### 7. Requirements live in `docs/business/` and `docs/technical/` — one shape, three trees

Every context has the same coordinates in three trees, so *what the business needs*, *how it is
designed* and *how far it has got* are one lookup in three files:

```
docs/business/<big_context>/<small_context>.md          what the business needs — HUMAN-WRITTEN
docs/technical/<big_context>/<small_context>.md         how it gets built     — HUMAN-WRITTEN
docs/development_state/<big_context>/<small_context>.md how far it has got    — AGENT-WRITTEN
```

- **`docs/business/` and `docs/technical/` are the owner's.** They are the source of truth; read
  them before proposing anything (see RULE 7b for what you may and may not write there).
- **`docs/development_state/`** is a summary of the state of development, written by the agent at the
  end of a pass so the next agent starts oriented. Never hand-maintained as prose to be read by
  people — it exists to be read by the next agent.
- `<small_context>` is deliberately loose: the smallest slice that can go through the lifecycle.
- `guidelines/` still holds the programmer-authoritative service and code guidelines
  ([guidelines/service-guideline.md](guidelines/service-guideline.md)) — do not rewrite anything in
  it without an explicit ask.

> ⚠ **`disscuss/` is GONE.** Design is no longer argued out in a separate folder and promoted; it is
> written in `docs/technical/` and questioned in a `_clarify.md` beside it. Anything still referring
> to `disscuss/` — or to `docs/requirements/` — is stale.

### 7b. The owner's doc is THEIRS — your response goes in `<name>_clarify.md` beside it (owner)

A requirement doc in `docs/business/` or `docs/technical/` is written by the owner. **Never edit it,
never rewrite it, never "tidy" it, never append a section to it.** Not a heading, not a typo, not a
broken diagram.

**You may create exactly two files beside it, and nothing else:**

```
docs/technical/ledger/mutation_and_ledger.md           ← the owner's. READ-ONLY to you.
docs/technical/ledger/mutation_and_ledger_clarify.md   ← everything you have to say about it.
docs/technical/ledger/mutation_and_ledger_decision.md  ← what the owner decided, recorded.
```

- **`<filename>_clarify.md`** — same directory, same basename, `_clarify` suffix. One clarify file
  per doc, never a shared one. It is the **current open set**: a point the owner has since answered
  is **deleted**, not left standing with a strikethrough.
- **`<filename>_decision.md`** — the opposite lifecycle: **append-only**. When the owner answers,
  the answer is written here before it is acted on, each entry carrying what it decided (RULE 12 —
  named, not numbered) and its reasoning. A decision that lives only in chat is a decision the next
  agent will re-litigate.
- **That two-file allowance is the whole allowance.** Anything else in the owner's trees is theirs
  to create.
- **When the owner updates the doc, RE-EXAMINE and UPDATE the clarify file.** It tracks the doc, so
  it is always the current open set — while `_decision.md` keeps the record of what was settled.
- **A question goes in the clarify file of the doc that can ANSWER it.** (owner) A template doc
  cannot decide its implementer's column types, and an implementer's doc cannot decide the template's
  shape. Before writing a question, ask *which doc's author settles this?* — and put it there.
  Asking in the wrong file makes the owner answer it twice, or answer it somewhere it will not be
  found. When a doc gains a downstream doc, **re-route** anything already misfiled and leave a one-line
  pointer saying where it went.
  ```
  ledger/mutation_and_ledger.md   the TEMPLATE   → "one change column, or one per measure?"
  stock/design.md                 the INSTANCE   → "is valuation numeric or integer rupiah?"
  ```
- **Something wrong in the owner's file is REPORTED, not fixed.** A mermaid diagram that fails
  `npm run lint:mermaid` (RULE 3), a contradiction (RULE 11), a schema that can't work — all of it
  is a clarify entry naming the line, never an edit to the doc.
- The clarify file follows RULE 8b in full: short, visualised, every critique carrying its own
  `**→ Recommend:**` inline.

> This exists because the alternative was tried and failed. The owner deleted 14 discussion docs
> (~8,300 lines) that had my argument, my critique and my decision-log braided into the design — the
> plan was no longer previewable, and no longer the owner's. Separating the two files is what keeps
> the plan readable as a plan.

### 8. Don't settle open questions unilaterally

This is a collaborative design. When a decision is needed, put it in the relevant
clarity file as an option with its trade-offs and **ask** — do not quietly pick one and build on
it.

### 8b. How we discuss (owner)

Applies to the owner's requirement trees (`docs/business/`, `docs/technical/`) and to replies in chat.

1. **Write LESS markdown.** The owner previews these docs — a wall of prose is not reviewable.
   Short sections, tight tables, no restating. Prefer a table or a list over a paragraph.
2. **Always propose a recommendation.** Never lay out options and stop; say which one you would
   pick, in a line or two. This does not override RULE 8 — recommend, then let the owner decide.
3. **When the owner proposes a plan / architecture / idea, answer in this shape:**

   ```
   ## Critique
   ### Recommendation
   ## Question
   ```

   Critique names the weakness, Recommendation says what to do instead, Question is what you need
   back. The owner answers and clarifies — that is the loop. **That shape is the
   shape of the `_clarify.md` file** (RULE 7b) — it never goes in the owner's doc.
4. **The owner's doc is not yours to edit** (RULE 7b) — your response is the `_clarify.md` beside it.
5. **Do not lean on what this project already does.** Existing architecture, models and concepts are
   a **reference for discussion, never a justification**. Analyse them freely for weakness,
   trade-off and bug potential — "it is already built that way" is not an argument. This is RULE 1
   turned inward.
6. **When the owner decides, RECORD IT** in the `_decision.md` beside the doc, and delete the
   answered question from the `_clarify.md`.
7. **Always visualise.** We discuss to DESIGN, so every design doc carries diagrams — grains, flows,
   states, sequences, before/after. A picture is how the owner reads it. Mermaid, and it must parse
   (RULE 3: `npm run lint:mermaid`).
8. **Write the RESULTING DESIGN, not just the argument.** A response that is all critique and
   questions leaves the owner nothing to preview. Carry a **`## Proposed Design`** — the concrete
   outcome: tables, schema, components, flow. Critique says what is wrong, Recommendation says what
   to do, Proposed Design says **what it IS**. This lives in the `_clarify.md`
   (RULE 7b) as a proposal *for* the owner's doc — you never write it into the doc yourself.
9. **We are DIALECTIC — brainstorming together, not delivering verdicts.** The owner argues back and
   so should you: hold a position, defend it with the warehouse and the trade-offs, and change it when
   the counter-argument is better. Say "I think X because Y — what breaks?" rather than presenting a
   finished answer. The doc records the *current state of the argument*, so **prune it as points get
   settled** — a doc that only ever grows stops being previewable (RULE 8b.1).
10. **Every critique carries its own recommendation, inline.** A problem stated without a proposed fix
    beside it makes the owner scroll to a distant list and re-pair them. One `**→ Recommend:**` line
    under each point — or a `→ Recommend` column when the critique is a table. The standalone
    `## Recommendation` then holds only the CROSS-CUTTING decision, not a re-list.
11. **A decision is recorded with its VISUALISATION and SPEC — never as a bare verdict.** A closed
    decision carries the diagram and the concrete specification that makes it buildable, so it can be
    read on its own without mining the argument that produced it. This is what a `## Proposed Design`
    in a `_clarify.md` (RULE 8b.8) and an entry in a `_decision.md` both owe the reader.
    ⚠ **There is no decided/open split to maintain** — the owner's own doc IS the
    proposal (RULE 7b), and an empty heading there means "not designed yet", not "open question".

### 9. A list RPC over data that can grow MUST paginate

Any RPC returning a `repeated` result whose size **grows with the data** takes a required
`warehouse.common.v1.PageFilter page` and returns a `warehouse.common.v1.PageInfo page_info`. An
unpaginated growing list is a latent slow-query / out-of-memory bug that only bites once the table
is full — so the default is: **when in doubt, paginate.** Removing a page filter later is a
breaking change; adding one to a list that already hurts is an incident.

- **Complies today:** `TeamList`, `UserList`, `ProductList`, `TeamAccessList`, `UserTeams`. A
  capped typeahead like `SearchUser` (a `limit` of 1–20) satisfies the intent without a page
  cursor — it can never return "everything". `TeamAccessList` / `UserTeams` return one person's
  memberships (a handful in practice) but page anyway, for consistency — the bar is "returns a
  list", not "is currently large". A caller that needs the whole set (the team switcher) asks for
  a large first page.
- **Exempt — bounded reference data, and the proto says so:** `ShippingList` (the courier
  catalogue: curated, rarely-changing, dozens of rows). The moment it can grow unbounded, it stops
  being exempt.
- **The tree exception:** a picker that needs the WHOLE tree at once — `CategoryList` backing
  `CategorySelect` — cannot page, because a page is a flat window and a tree needs every node to
  assemble. A full-tree read is allowed ONLY as a deliberate, documented **picker feed**. A
  *browse / management* screen over the same growing data must still paginate (load a level's
  children by `parent_id`, which is naturally small). Never let a "load everything" read quietly
  become the backing for a growing management list.

### 10. The frontend is ALWAYS FRESH — and never blanks while it refreshes

`staleTime: 0` in [frontend/src/api/queryClient.ts](frontend/src/api/queryClient.ts). Every read
refetches on every mount, tab switch, page turn and filter change. (owner)

The people using this app work in pairs on a shared stock level, from a scanner and a phone at the
same shelf. "The number I am reading was true half a minute ago" is not a property a stock count can
have — **freshness here is correctness, not polish.** This reverses an earlier 30s window that
optimised for request count; that argument was answering a different question.

**The two halves are a PAIR. Never adopt one without the other:**

| | |
| --- | --- |
| `staleTime: 0` | *whether* we refetch → always |
| `placeholderData: keepPreviousData` | *what is on screen while it runs* → the previous rows |

Always-fresh **without** keeping the previous rows trades a stale screen for a flickering one — the
table tears down on every interaction instead of only on uncached ones. That is strictly worse than
what it replaced.

So, three requirements on any list:

1. **A paginated or filtered list spreads `listQuery`.** Not the raw option — the preset, so the
   reason travels with the setting and every list is findable by one name.
2. **It wraps its table in [`RefreshOverlay`](frontend/src/components/feedback/RefreshOverlay.tsx)**, with
   `busy={query.isFetching && !query.isPending}`. Kept rows with no indicator are a screen that
   silently lies about how current it is. The overlay waits 150ms before showing, so a fast refetch
   never flickers — that delay is the component's job, not the caller's.
3. **`isPending` is excluded from `busy`, always.** A genuine first load has no rows to keep and
   shows the page's own spinner; dimming an empty table behind a progress bar is two loading
   indicators for one wait.

⚠ **`listQuery` is NOT a global default, and must not become one.** It is right when a key change
*refines the same question* (page 2, the Fulfilled tab, supplier = Ani) and wrong when the key change
picks a *different subject*. A by-id detail hook keyed on product 5 would spend a beat rendering
product 5 under a URL that already says product 9 — which reads as the wrong record having loaded.
The two dozen by-id hooks stay on the plain default.

**The one buy-out is `referenceQuery`** — a picker feed or a name lookup (`TeamSelect`'s options, a
debounced product search, a team's shops). That data is read to LABEL something, not to work from; it
is re-read every time a dropdown mounts, several times per screen, and a stale courier name is
cosmetic where a stale stock count is not. Buy out **by name**, never by hand-writing a `staleTime`.
`useTeams` carries a `reference` flag because it is the one hook with callers on both sides.

Not everything went through TanStack: `CategorySelect`, `SupplierSelect`, `RackSelect`,
`ProductPicker` and the courier catalogue run their own `useEffect`/session caches and never saw
`staleTime` at all. If you touch one, it is not covered by this rule until it moves to a query hook.

`refetchOnWindowFocus: false` **survives** this change and is not an inconsistency — it answers a
third question. The app is used with a scanner and a spreadsheet beside it, so focus is lost and
regained constantly; a refetch per alt-tab is a request storm, and staleness is already handled by
refetching whenever the screen actually asks something.

### 11. A contradiction found in a design doc is RECORDED, not just fixed

Every design doc carries a **`# Contradiction`** section. When a decision is found to contradict
something already written, **fix it AND write it there** — with the example, the recommendation, and a
diagram (RULE 8b.7: everything is visualised). In a `guidelines/` doc that means fixing the text and
recording what went stale.

⚠ **`# Contradiction` lives in the `_clarify.md`, and nothing is fixed** (RULE 7b).
A contradiction inside the owner's plan doc is reported — quote both lines, say which one you think
is wrong, recommend — and the owner resolves it in their own file.

```
# Contradiction
## <what contradicted what>
   the EXAMPLE — the two statements, quoted, and which one was wrong
   → RECOMMEND — what to do, and what stops it recurring
   a mermaid diagram of the ripple
```

**Why this is a rule and not a habit.** A decision changes one paragraph and leaves five others
asserting the old answer — and stale text in a settled section is *worse* than an open question,
because it reads as authoritative. In practice one decision has repeatedly left several contradictions
behind, and the same places keep going stale: **any table where every case appears together** is where
they collect, because it is the only place a changed rule has to be restated N times.

- **Fixing silently is not enough.** The next decision will ripple the same way, and the record is what
  makes the pattern visible instead of feeling like bad luck each time.
- **Group by CAUSE, not by symptom.** Seven stale rows from one decision is **one** contradiction with
  seven sites — not seven entries.
- **Re-examine after every decision that touches a shared table**, and say plainly what was found. "No
  contradictions" is a real and useful answer; silence is not.

### 12. A decision is NAMED and LINKED, never numbered

In the requirement trees and `guidelines/`, every decision carries a **kebab-case name that says what it
decided** — `mint-per-layer`, not `F2` — and **every reference to it is a markdown link to the section
that defines it**, so the owner can click through and read it instead of scrolling to look it up. (owner)

```markdown
| [mint-per-layer](#mint-per-layer) | A transfer receipt mints ONE BATCH PER SOURCE LAYER in B |
…later, in prose…
⚠ [mint-per-layer](#mint-per-layer) removed the average, so a `nil` layer now stays `nil`.
…and across docs…
See [rack-order](fifo.md#rack-order) — the transfer out-leg has no rack rule yet.
```

An ordinal is a **label with no content**. It has to be looked up, it cannot be clicked, and it collides
the moment two sibling docs both reach their seventh decision — **`P7` already means the ledger's write
protocol in one doc and the transfer-FIFO rule in another**, which is why references had to be written
"ledger P7" / "batch_selection P7" to stay unambiguous.

- **The heading IS the name — alone, unpunctuated.** `## mint-per-layer`, so the anchor is exactly
  `#mint-per-layer` and never has to be guessed. A decorated heading like ``## `mint-per-layer` · the
  spec`` anchors to `#mint-per-layer--the-spec`, and that is how a link rots.
- **A bare name is an incomplete reference.** Writing the name without the link is the same lookup cost
  as a number, just friendlier — the link is the point.
- **Name the VERDICT, not the topic.** `mint-per-layer` beats `batch-minting`: the reference should read
  as a sentence — *"per `facts-travel`, `expires_on` copies verbatim"*.
- ⚠ **If a decision REVERSES, rename it and grep every reference.** That is the price of a name carrying
  its verdict, and it is the discipline HARD RULE 11 already requires.
- **The decided list at the top links; it does not restate.** One row per decision, its name linked to
  the section that holds the diagram and the spec (RULE 8b.11).

---

## Layout

```
go.mod       the Go module — rooted HERE, so backend/ and tools/ are one module (HARD RULE 3b)
proto/       the API contract — ONE place, one buf module, one generate
backend/     Go server (Connect RPC) — services/<service_name>/ (HARD RULE 2)
tools/san/   the operations CLI — a tool of the repo, not of the server (HARD RULE 3b)
frontend/    React + TypeScript (Vite), Connect RPC client
docs/business/    what the business needs — owner-written (HARD RULE 7)
docs/technical/   how it gets built — owner-written (HARD RULE 7)
docs/development_state/  how far each context has got — agent-written (HARD RULE 7)
guidelines/  programmer-authoritative service + code guidelines
docs/faq/    the team FAQ — every question already asked, with its answer (see below)
```

Generated code is committed (`backend/gen/`, `frontend/src/gen/`) but **never hand-edited** —
regenerate instead.

## The FAQ — record an answer once

Several people build this and people join. The same questions get asked, answered in chat, and
lost — and the second answer differs slightly from the first. [docs/faq/](docs/faq/) is where the
answer goes instead.

- **Answer a question that could be asked again → write it into `docs/faq/` the same day**, and add
  its row to [docs/faq/readme.md](docs/faq/readme.md) in the same commit. The `faq-create` skill does
  both.
- **The FAQ explains and points — it is never a second source of truth.** The authority stays
  `CLAUDE.md`, `guidelines/`, the code and the other `docs/`; an entry gives the short answer and
  links there.
- **"Not decided yet" is a valid entry** — say so and link the `_clarify.md` holding the open question (or say
  plainly that nothing has been written yet). Never settle an open design question in the FAQ
  (HARD RULE 8).
- **When a rule changes, grep `docs/faq/` in the same commit.** A wrong FAQ entry is worse than a
  missing one: it is confidently wrong and the reader has no reason to doubt it.

## The proto contract

One buf module at [proto/](proto/) serves both sides. A single `buf generate` emits the Go
server stubs and the TypeScript client together, so a contract change is one edit and one
command — no publish step in the middle of the design loop.

- Domain separation comes from **directories** (`proto/warehouse/<domain>/v1/`); evolution
  comes from **proto package versions** (`v1` → `v2`) — not from splitting the module.
- The proto package must match the directory (`warehouse.hello.v1` ⇢
  `proto/warehouse/hello/v1/`) — buf's `STANDARD` lint enforces it.
- After **any** `.proto` edit, run `buf generate` from `proto/` before building either side.
- **The plugins are `local:`, and they need NO Buf account.** They were `remote:` BSR plugins, which
  meant a token nobody's checkout had — and with `clean: true` a failed run **deletes `backend/gen`
  and `frontend/src/gen` before failing**, so the documented command was destructive on a fresh
  machine. Now `protoc-gen-go` and `protoc-gen-connect-go` are `tool` directives in the root
  [go.mod](go.mod) and `protoc-gen-es` is a devDependency in
  [frontend/package.json](frontend/package.json).
  - **Prerequisite: `cd frontend && npm install` must have run** — the TS plugin lives in
    `frontend/node_modules`, so generation fails without it.
  - **Run it from `proto/`.** Two plugin paths are relative to the working directory.
  - ⚠ **Never `go install` the plugins onto PATH instead.** A global `protoc-gen-go` is whatever
    another project needed, and generating with it rewrites every file with a different version
    stamp — exactly the drift CI checks for. **A generator and the runtime it generates against must
    be the same version**, which is what pinning them as dependencies enforces.

`HelloService` is scaffolding — it exists only to prove the pipeline works end to end. Delete
it once a real domain service replaces it.

## Commands

| Task | Command |
| --- | --- |
| Start local Postgres (`:5433`) | `docker compose up -d` |
| Lint the contract | `cd proto && buf lint` |
| Regenerate Go + TS | `cd proto && buf generate` — needs Go and `frontend/node_modules`; **no Buf account** |
| Run the API (`:8080`) | `cd backend && go run ./cmd/app_development` |
| Build / vet / test Go | `go build ./... && go vet ./... && go test ./...` — **from the repo root**, so it covers `tools/` too |
| Migrations | `go run ./tools/san migrate <cmd> --service <svc>` |
| Operations CLI (`san`) | `go run ./tools/san user reset-password --username <u>` — from the repo root |
| Create the event topics + subscriptions | `go run ./tools/san pubsub ensure --project warehouse-dev --emulator` — **nothing else creates them** |
| Serve this checkout to a coding agent | `go run ./tools/san remote` — Connect RPC **and** MCP at `/mcp`; prints a token kept in `.san/remote-token.json` and REUSED across restarts (`--no-persist-token` for one run only); loopback by default |
| Serve it to a hosted agent (Claude Web) | `go run ./tools/san remote mcp --public-url https://<tunnel>` + a tunnel to `:8099` — MCP only. **Without `--public-url` it answers 403 to everything** |
| Run the UI (`:5174`) | `cd frontend && npm run dev` |
| Typecheck the UI | `cd frontend && npm run typecheck` |
| Build the UI | `cd frontend && npm run build` |
| E2E (starts both servers) | `cd frontend && npm run e2e` |
| Component workbench (`:6006`) | `cd frontend && npm run storybook` |
| Run every story's `play()` as a test | `cd frontend && npm run test:stories` |
| Build the static Storybook | `cd frontend && npm run build-storybook` |
| Check every mermaid diagram parses | `cd frontend && npm run lint:mermaid` |

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
| `warehouse.events.v1.event_config` | `MessageOptions` | 50001 | which Pub/Sub topic an event VARIANT belongs to |
| `warehouse.role_base.v1.request_policy` *(planned)* | `MessageOptions` | 50002 | who may call an RPC (see the roling section above) |

**The generated option package must be linked into the binary**, or `proto.HasExtension`
silently returns false and the option appears absent. It reads as a logic bug; it is a linking
bug.

### Events — [backend/pkgs/event_source/](backend/pkgs/event_source/)

An event names its own topic; a publisher never does:

```proto
message OrderPlaced {
  option (warehouse.events.v1.event_config).topic = "order-placed";
}
```

`TopicName(event)` unwraps the envelope's `oneof` and reads the SET VARIANT's topic,
`NewPubsubEventSender(client)` publishes there, and `NewMuxPushHandler` receives on an HTTP push
subscription, handing the handler a DECODED `*eventsv1.Event` (trace context rides in the message
attributes both ways). `EmptySender` validates and drops — use it in tests instead of a broker.

The sender takes the caller's identity as a PARAMETER, never from `ctx`; `SystemIdentity(agent)` is
what a caller with no user passes. Topics and subscriptions are created by
`go run ./tools/san pubsub ensure` and by nothing else — no service checks its setup at boot.

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
  `@connectrpc/connect-web`, Playwright for e2e, Storybook 10 + Vitest browser mode for components.
  Connect-ES v2 needs no separate service plugin: `protoc-gen-es` emits the service
  descriptor, and the client is `createClient(HelloService, transport)`.

### Frontend structure — `layouts/`, `pages/`, `features/` (owner, #199)

```
frontend/
  .storybook/         the workbench: main/preview config, the stub transport, the fixtures
  src/
    layouts/          the shell — TWO of them, and exactly one mounts (see below)
      Layout.tsx      the picker: a breakpoint chooses desktop or mobile
      shell.ts        the breakpoint + the page canvas — both shells read them
      nav.ts          the menu, the "where am I" match, the bottom bar — SHARED
      TeamSwitcher.tsx  shared: the sidebar's card, and the mobile top bar's chip
      desktop/        DesktopLayout (sidebar + breadcrumb top bar), Sidebar
      mobile/         MobileLayout (compact top bar), BottomNav, MenuSheet
    pages/<page>/
      index.tsx       THE page component — one directory per SCREEN
      components/     used by THIS page and nothing else
    features/<domain>/  queries + anything shared by SEVERAL pages of one domain
    components/<group>/ the design system (see below) — shared app-wide, grouped
                      by KIND, each with its <Component>.stories.tsx beside it
    api/ lib/ i18n/ gen/ theme.ts router.tsx
```

**A phone gets a DIFFERENT SHELL, not the desktop one squeezed.** `Layout` reads one media query
(`useIsMobile`, Chakra's `md`) and mounts `DesktopLayout` — a persistent 258px sidebar beside a
breadcrumb top bar — or `MobileLayout`: a compact top bar (team chip, screen name, notifications), and
navigation moved to a **bottom tab bar** the thumb reaches, carrying this team's three destinations
plus **More**, which opens the full menu as a full-screen sheet. There is no hamburger on a phone.

- ⚠ **Exactly ONE shell mounts** — a JS breakpoint, never `hideFrom`/`hideBelow`. Hiding one with CSS
  renders both: two `<Outlet/>`s (every page mounted twice), two `navigation` landmarks, and two of
  every `data-testid` the e2e reach for.
- **Everything that THINKS is shared**: `nav.ts` builds the menu from the team's type and your role,
  answers "where am I" (longest-prefix), and decides the bottom bar; `shell.ts` owns the breakpoint and
  the grey page canvas. A rule living in one shell is a rule the other one breaks.
- **The bottom bar's three tabs are a DECISION, filtered against the real menu** (`bottomBarFor`) — a
  tab is never offered for a screen this team's menu does not contain.
- Each shell is reviewed and tested directly in Storybook (`Layouts/Desktop/*`, `Layouts/Mobile/*`);
  `Layout` itself has no story, because the runner has one fixed viewport.

**One directory per PAGE, named for the screen** — `pages/order-create/`, not
`pages/orders/new/`. Flat and route-descriptive, so every directory has exactly one `index.tsx` and
the `components/` beside it can only mean that one page. A nested tree mirroring the URLs makes
`components/` ambiguous the moment a parent and a child both have one.

**The test for where a file goes is HOW MANY PAGES USE IT:**

| Used by | Goes in |
| --- | --- |
| one page | `pages/<page>/components/` |
| several pages of one domain | `features/<domain>/` |
| the whole app, and it is a UI primitive | `components/` (the design system) |

A `queries.ts` is almost always `features/`, because a domain's reads are shared by its list, its
detail and its form. Two of the pickers (`CategorySelect`, `ShippingSelect`) had been living in domain
folders while being curated gallery components — if a component exports a `description`, it belongs in
`components/`.

> ⚠ **`pages/<page>/components/` means ONLY THIS PAGE.** The moment a second page imports one, it has
> become a domain component and belongs in `features/`. Leaving it where it was is how a page
> directory quietly turns into a domain module and the rule stops meaning anything.

### The design system

**BEFORE writing any frontend, look for a shared component that already does it.** (owner, #143)
`frontend/src/components/` holds 39 of them, **grouped by kind**, every one with a **Storybook**
story beside it (`<Component>.stories.tsx`). `cd frontend && npm run storybook` is the fastest way
to see what exists; `graphify query "what shared components exist for <the thing>"` works too.

| `components/<group>/` | | |
| --- | --- | --- |
| `pickers/` | 16 | choose a thing — every `*Select`, `ProductPicker`, `AddressPicker` |
| `datetime/` | 6 | the date/time family — the pickers, plus `PeriodGrainPicker`, the resolution a range is read at |
| `entity/` | 5 | show a product / a team / a person the same way everywhere |
| `badges/` | 4 | a status or a kind, in its ONE standard colour |
| `feedback/` | 3 | what the app says back — `ConfirmDialog`, `RefreshOverlay`, `Toaster` |
| `chrome/` | 3 | app furniture — `Logo`, `Pagination`, `ColorModeToggle` |
| `inputs/` | 2 | a typed value, formatted or masked |

The **Storybook sidebar mirrors these folders one-for-one**, so "where does this live?" and "where do
I find it?" have the same answer. A new component goes in the group it belongs to and its story's
`title` is `Components/<Group>/<Name>` — if neither is obvious, the component is probably two things.

This is not only about saving effort — **a re-implementation is how two screens start disagreeing.**
The pickers carry rules learned the hard way and invisible from the outside: `RackSelect` keeps
"unplaced" *selectable* while its placeholder stays disabled, because a place is not an absence
(#136/#139); `SupplierSelect` and `ShippingSelect` had that exact bug and were fixed in #131;
`ProductListItem`'s stock badge is shown even at ZERO, because out-of-stock is the case worth seeing
(#138). A fresh `<select>` gets none of that — and each of those rules is now a story that fails if
somebody removes it.

If nothing fits, prefer **extending the shared component over forking it** — and if you do add one,
it needs an `export const description` and a story file in the same change (see below).

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
  reversible — goes through a [`ConfirmDialog`](frontend/src/components/feedback/ConfirmDialog.tsx) (Chakra
  `Dialog`) before it runs. Never a bare one-click destructive button.
- **Dialog titles are Title Case.** "Delete Product", "Reset Password for …", "New Category" — not
  "Delete product" / "reset password". This includes the `title` passed to `ConfirmDialog`.
- **A detail view is a PAGE, not a dialog.** "See the full record" — user detail, team detail,
  warehouse detail, and every one that follows — is a dedicated route (`/users/:id`,
  `/teams/:id`, …), reached by clicking the row. A dialog is for a focused *action* (create, edit,
  confirm), not for *reading* an entity. Only use a dialog for a detail view on an explicit ask.
- **Every shared component has a STORY beside it, and the story is the documentation.** (owner)
  `frontend/src/components/<Component>.stories.tsx`, in the same commit as the component. It carries
  the states worth reviewing AND a `play()` function per behavioural rule — see *Storybook* below.
  A component exporting `description` feeds it straight into the story's docs page
  (`parameters.docs.description.component`), so the sentence lives once, in the component.

  > This replaced a hand-written gallery page at `/components` — 1238 lines of JSX that rendered
  > each component beside its `description`. It documented but never *checked*: every rule in those
  > descriptions could be broken without anything failing, and the page had to be edited by hand for
  > each new component. The stories cover the same ground and fail when a rule is broken.

### Storybook — the component workbench, and the third test layer

Every shared component is developed and documented in **Storybook 10**, and every story is also a
**test**: Vitest renders it in a real Chromium and runs its `play()` as the test body. One
definition is both the thing the owner reviews in the sidebar and the thing CI fails on.

```sh
cd frontend
npm run storybook        # the workbench, on :6006
npm run test:stories     # every story's play() headlessly — the one to run after a component change
npm run build-storybook  # the static site (storybook-static/, gitignored)
```

**Where the layers sit.** This does not replace Playwright: `npm run e2e` drives the whole app
against a real Go server and a real Postgres, while a story pins ONE component with the API stubbed.
A regression in `RackSelect` should fail here in a second, naming the component — not as a mysterious
timeout in an order-flow spec.

**The API is stubbed at the TRANSPORT**, not per hook — [.storybook/stubTransport.ts](frontend/.storybook/stubTransport.ts)
is a `createRouterTransport` fake that replaces `src/transport.ts` at build time
([stubTransportPlugin.ts](frontend/.storybook/stubTransportPlugin.ts)). That module has exactly ONE
importer (`src/api/clients.ts`), so all ~106 client consumers are stubbed at a single seam and no
component needs a Storybook-only prop. The component then runs its REAL query hook, adapter, loading
and error states. Fixtures are [.storybook/fixtures.ts](frontend/.storybook/fixtures.ts), imported by
the stories too, so a story asserts on the same values the stub served.

- ⚠ **The swap is a `resolve.alias`, not a `resolveId` hook.** Storybook and the Vitest browser
  runner pre-bundle `clients.ts` as an optimized dep, and that scan does not run project `resolveId`
  hooks — it fails OPEN, serving the real transport, and the only symptom is pickers that never fill.
- **An unstubbed method throws `unimplemented`**, which shows up as a visible error rather than an
  empty dropdown that reads as a styling bug. Add the method to the router when a component needs it.
- **`parameters: { signedIn: true }`** wraps a story in `AuthProvider` + `TeamProvider`. Opt-in, and
  only `ProductPicker` needs it (it reads `useTeam()`, which throws outside the provider).

**Things that will bite when writing a story:**

| | |
| --- | --- |
| `Select.HiddenSelect` renders a native `<option>` per item | query by **role**, not text, or every `getByText` matches twice |
| Popovers/listboxes animate in | `await waitFor(() => expect(el).toBeVisible())` before clicking — until then `pointer-events: none` rejects the click |
| Some pickers portal, some deliberately do not | `screen` for portalled (TeamSelect, RoleSelect); `within(canvasElement)` for the inline ones (RackSelect, ShopSelect, MarketplaceSelect, CategorySelect — they must work inside modal Dialogs) |
| A controlled input needs real state | a story pinning `value` to a constant re-renders the field back after every keystroke, so typing tests nothing. `userEvent.type(el, "…", { delay: 40 })` too — at machine speed a controlled input drops characters |
| Module-level caches survive between stories | the shipping catalogue and the color-mode/token storage are reset in `preview.tsx`'s `beforeEach` |

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

Auth is deliberately **not wired** into the frontend shell: it is still being designed.

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

## Development lifecycle

**[docs/development_lifecycle.md](docs/development_lifecycle.md) is the development flow.** A
requirement is defined by the owner, analysed, questioned if unclear, implemented frontend-first,
tested, and summarised into `docs/development_state/`. Read it before picking up work.

The two entry lanes and where their docs live (HARD RULE 7):

| lane | the owner writes | you write beside it |
| --- | --- | --- |
| business | `docs/business/<big>/<small>.md` | `<small>_clarify.md`, `<small>_decision.md` |
| technical | `docs/technical/<big>/<small>.md` | `<small>_clarify.md`, `<small>_decision.md` |

**`implementation_analysis` is frontend-first and previewable** — pages and components are built in
Storybook with mock wiring so the screen can be looked at *before* the backend exists. That is HARD
RULE 6 made concrete: the contract is derived from what a page must show and do, not the reverse.

**When the analysis raises a question, it goes in the `_clarify.md` and the answer comes back as a
`_decision.md` entry** (HARD RULE 7b). Do not settle it yourself (HARD RULE 8).

**Whenever you write or change a `_clarify.md`, rebuild [docs/biggest_question.md](docs/biggest_question.md)** —
the rollup of every open question, ranked by what is BLOCKED. It is derived: never hand-edited, built
from `_clarify.md` only (never `_decision.md`), and the seven shown are a display cap, so it always
says how many are not shown and where they live.

**At the end of a pass, write the state report** — `docs/development_state/<big>/<small>.md`. It is
written for the next agent, not for a person: what exists, what does not, what was decided.

## Git workflow

All work happens on a single long-lived **`dev`** branch. Commit straight to `dev` — do **not**
create a branch or a PR per task. The owner keeps `dev` checked out to preview the running app and
review as work lands, so branch-switching just gets in the way.

- Keep `dev` green: `buf lint`, `go build/vet/test`, frontend typecheck, and the Playwright spec for
  the work in hand should pass at each commit. CI runs the full suite.
- Promote to `main` by merging `dev` → `main` **when the owner asks**. Never force-push `main`;
  never push `main` or merge without an explicit ask.

CI (`.github/workflows/ci.yml`) runs on push-to-`main` and every PR: buf lint + generated-drift
check, `go build/vet/test`, frontend build, and Playwright e2e against Postgres + Redis service
containers.

## graphify

This project uses [graphify](https://pypi.org/project/graphifyy/) to turn the codebase into a
queryable knowledge graph.

**Status: the graph is BUILT and ACTIVE** (`graphify-out/graph.json` exists; the `PreToolUse`
hook fires the query-before-grep hint). Real modules have landed, so the rules below apply. Keep
it current: run `graphify update .` after landing code changes (AST-only, no API cost). The
semantic pass is skipped unless `GEMINI_API_KEY` / `GOOGLE_API_KEY` is set — the AST graph alone
answers structural queries, which is the no-cost default.

### Invoking it

graphify is not on PATH. It lives in this repo's venv:

```sh
.venv/Scripts/graphify.exe --help        # direct (Windows)
source .venv/Scripts/activate            # or activate, then bare `graphify`
```

### Building and keeping it current

```sh
graphify .                # full rebuild (semantic pass; costs API tokens)
graphify update .         # after changing code — AST-only, no API cost (the routine one)
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
