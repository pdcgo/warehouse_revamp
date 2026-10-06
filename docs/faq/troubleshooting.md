# FAQ — Troubleshooting

Symptoms people have actually hit, and what they turned out to be.

---

## My mermaid diagram renders as an error box

Run the parser — do not eyeball it, and do not grep for suspicious characters:

```sh
cd frontend && npm run lint:mermaid
```

A broken diagram is invisible in review: the markdown looks fine in the diff.

The usual culprit is **`;`**. Characters that are ordinary in prose are syntax to mermaid, and in a
`sequenceDiagram` message or `Note` a semicolon **ends the statement**, so the whole diagram fails.

- In sequence messages and notes, write **`—`** or **`,`** where you would naturally write `;`.
- A `subgraph` title containing punctuation (`—`, `§`, `(`) must be **quoted**:
  `subgraph "warehouse side — undesigned §1"`.
- **Do not grep for the dangerous characters** — whether `;` breaks anything depends on where it
  sits. Inside a quoted `erDiagram` comment it is harmless; in a sequence message it is fatal. When
  this check was introduced, a grep flagged 24 lines of which 5 were real, and it missed a broken
  `subgraph` title that contained no semicolon at all.

---

## `graphify: command not found`

It is not on PATH — it lives in this repo's venv:

```sh
.venv/Scripts/graphify.exe --help       # direct (Windows)
source .venv/Scripts/activate           # or activate, then bare `graphify`
```

Use it **before** grep/read for codebase questions — it returns a scoped subgraph, usually far
smaller than raw grep output:

```sh
graphify query "how does the access interceptor read the team scope"
graphify explain "<concept>"     # a focused concept
graphify path "<A>" "<B>"        # how two things relate
graphify affected "<X>"          # blast radius before a change
graphify update .                # after landing code changes — AST-only, no API cost
```

Note the PyPI package is **`graphifyy`** (doubled y), so `pip show graphify` comes back empty.

---

## `python3: command not found`

There is no python3 on this machine, and `python` is a broken stale virtualenv. Write tooling and
hooks in **Node**; make venvs with `uv`.

---

## Storybook pickers never fill — every dropdown is empty

The stub transport did not get swapped in. The swap is a **`resolve.alias`, not a `resolveId`
hook**: Storybook and the Vitest browser runner pre-bundle `clients.ts` as an optimized dep, and
that scan does not run project `resolveId` hooks — it fails **open**, serving the real transport,
and the only symptom is pickers that never fill.

If a single component's data is missing instead, the method is probably not in the stub router — an
unstubbed method throws `unimplemented`, which surfaces as a visible error.

---

## My story needs `useTeam()` and throws

Add `parameters: { signedIn: true }` — it wraps the story in `AuthProvider` + `TeamProvider`. It is
opt-in because almost nothing needs it.

---

## `wire_gen.go` is not picking up my new provider

You have to regenerate — it is never hand-edited:

```sh
cd backend && go tool wire ./cmd/app_development
cd ..      && go tool wire ./tools/san          # tools/san has its own composition root
```

Use `go tool wire`, not `go run github.com/google/wire/cmd/wire` — wire is a `tool` directive in
`go.mod` so it survives `go mod tidy`; the `go run` form does not.

---

## `buf generate` output does not match what CI expects

CI runs a generated-drift check. Regenerate and commit both sides together:

```sh
cd proto && buf lint && buf generate
```

Both `backend/gen/` and `frontend/src/gen/` are committed and never hand-edited.

---

## The e2e passes locally but the results make no sense

`reuseExistingServer: true` — a **stray** server left on :8081 or :5175 from an earlier run gets
conscripted by the run instead of ignored. Kill anything listening on those ports and re-run.

---

## A port is already in use

| Port | Belongs to | If it is taken |
| --- | --- | --- |
| 5433 | Postgres (this project) | another `docker compose` for this repo is already up |
| 5432 | **not us** — another project's Postgres | fine, leave it alone |
| 5174 | the UI dev server | `strictPort` makes it fail loudly rather than drift to 5175 — which is the e2e's port |
| 5173 | **not us** — another project's dev server | fine |
| 8080 / 8081 | dev API / e2e API | a stray dev API, or a stray e2e run |
| 51234 | the story-test runner (`npm run test:stories`) | a second story run is still up |

---

## `npm run test:stories` dies with `listen EACCES: permission denied ::1:63315`

Not a permission problem and not a stray process. **63315 is Vitest's default browser port, and Windows
reserves the range it falls in** (Hyper-V / WinNAT). No story runs at all — the output ends in
"no tests".

```sh
netsh interface ipv4 show excludedportrange protocol=tcp   # 63315 sits inside one of these
```

The port is **pinned to 51234** in [frontend/vitest.config.ts](../../frontend/vitest.config.ts)
(`test.browser.api.port`). If that one is ever reserved too, move it outside every listed range — a
`--browser.api.port` flag on the command line does not reach the `storybook` project.

---

## Permission denied calling an RPC

See [backend.md](backend.md#why-is-my-new-rpc-returning-permission-denied) — four causes, in order
of likelihood. The most common one is a policy on the `rpc` instead of the request **message**.

---

## Something cached is stale after I changed a role/permission

If you are on `NewMemoryCacheManager`, eviction is **per process** — revoke on instance A and
instance B serves stale until its TTL lapses. Anything whose freshness is a *correctness* property
(authorization) needs Redis in production. Roles are cached about a minute and invalidated on every
membership change.

Also check `DelNamespace`: it matches a **literal prefix**, so `"role:1"` also evicts `"role:11"`.
End the namespace with a separator — `"role:1:"`.

---

## A Pub/Sub message keeps being redelivered forever

Pub/Sub treats any non-2xx as a NACK, so a permanently malformed message is redelivered forever.
**Push subscriptions must have a dead-letter policy** — the handler cannot distinguish poison from
transient, and silently ACKing bad payloads would lose them.

Local broker: `docker compose --profile pubsub up -d` (emulator on `:8085`, honours
`PUBSUB_EMULATOR_HOST`). In tests use `EmptySender`, which validates and drops.

---

## An import, or placing an order, hangs for about a minute

The Pub/Sub emulator is not running. Start it, and create its topics — nothing else does. From the repo root:

```sh
docker compose --profile pubsub up -d                                  # the emulator, on :8085
go run ./tools/san pubsub ensure --project warehouse-dev --emulator    # its topics
```

A write that publishes an event waits up to **60 s** for the broker's ack
([`publishTimeout`](../../backend/pkgs/event_source/sender.go)), then logs the failure and carries on,
and the write itself is committed. So nothing fails and nothing warns you. It is just a minute per
order placed, and a minute per row of a settlement statement, because each row is its own
`SettlementPost`. The dev server boots without a broker on purpose
([event_sender.go](../../backend/cmd/app_development/event_sender.go)). The e2e needs one too, and CI
starts it before the e2e.

**In the e2e it used to look like something else entirely:** the first test that places an order timed out after
10 s on the order form, its *Create Order* button stuck in its loading state, which reads as a form that never became
valid. Now the e2e setup checks first ([e2e/pubsub.ts](../../frontend/e2e/pubsub.ts)): with no emulator it stops in
a few seconds with *"The Pub/Sub emulator is not answering on localhost:8085"* and the command above, and with one it
runs `san pubsub ensure` itself — the topics live in the emulator's memory, so a restarted emulator has none.

⚠ `go run ./tools/san dev run` and `dev setup` start Postgres and Redis but **not** the emulator (no `pubsub` profile),
so the running dev app has the same minute-long wait until you start it.

---

## My MCP endpoint answers 403 to everything, but only through the tunnel

You did not pass `--public-url`. Restart with it:

```sh
go run ./tools/san remote --public-url https://devel.example.com
```

The MCP SDK carries a **DNS-rebinding guard**: a request that *arrives on loopback* while carrying
a *non-loopback `Host` header* is rejected. That is the exact shape of every tunnelled request —
`cloudflared` connects to `127.0.0.1` and forwards `Host: devel.example.com`. Locally everything
works, so the symptom only appears once a tunnel is in front, and the 403 says nothing about why.

The server does **not** infer this from the request, because that would mean dropping a security
guard whenever a caller sent a header — so the operator declares it instead. Details in
[docs/tools/san.md](../tools/san.md#putting-a-tunnel-in-front).

---

## My MCP client re-initializes on every call and loses its state

It cannot read the `Mcp-Session-Id` response header. For a browser-based client that means CORS:
the header must be in **`Access-Control-Expose-Headers`**, not merely allowed on the request. `san
remote` exposes it ([mcp_http.go](../../tools/san/remote/mcp_http.go)); a proxy or tunnel in front
that strips response headers will undo that.

---

## My MCP client connects but every tool call comes back unauthorized

The token is checked on **every** request, not just `initialize`. Two ways to present it, and the
**header wins** when both are there:

| | |
| --- | --- |
| `Authorization: Bearer <token>` | Claude Code, Claude Desktop, Cursor — anything with a headers map |
| `https://…/mcp/<token>` | a hosted client with only a URL box |

A token from a *previous* run will not work: `san remote` mints a fresh one per run and it dies
with the process. Re-read the banner, or pin one with `--token`.

---

## `GetDownloadUrl` says NotFound for a document I know exists

You are asking from the wrong team. The handler filters `id = ? AND team_id = ?`, so a document
belonging to another team comes back **NotFound rather than PermissionDenied** — deliberately, so an
id-holder cannot even confirm the file exists.

| you are | you get |
| --- | --- |
| a member of the document's team | the URL |
| a member of any other team | NotFound, every time |

**This is the design, not a bug** — see
[get_download_url.go](../../backend/services/document_service/document_v1/get_download_url.go). A
private document is scoped to the team that uploaded it, and the check cannot be widened without
opening every team's private files at once.

**So how does another team ever see one?** ⚠ **Not decided yet**, and the first real case is a
payment's proof of transfer: the creditor has to look at a file the payer owns. The proposal is a
**share grant** — the owner shares the document with another team, as themselves, and
`GetDownloadUrl` gains one clause: *owner **or** shared-with*. `document_service` learns *"shared
with team X"* and never *"this is a payment proof"*, so its invariant holds: **no read without a row
saying you may.** See
[technical balance C19](../technical/balance/team_balance_design_clarify.md#critique) ·
[balance Q10](../business/balance/context_clarify.md#question).

Until that is answered: **do not widen `GetDownloadUrl`**, do not teach `document_service` what a
payment is, and do not add an internal signing path that skips the scope check — one bug in the
calling service would then leak every private file in the system.

---

## Why is my settlement import refused?

Read the import's last line. A refused file ends on one `ERROR` line that says why, and **nothing
was posted**:

| the line says | because | do |
| --- | --- | --- |
| *… has no primary CS — choose a primary CS first* | a row naming no order (a withdrawal) is counted for the shop's primary CS ([a-shop-with-no-primary-cs-cannot-import](../business/settlement/settlement_importer_decision.md#a-shop-with-no-primary-cs-cannot-import)) | an owner or admin opens the shop and presses ★ beside one of its users |
| *You have no access to …* | no grant on the shop, and not the team's owner or admin ([a-write-needs-a-grant-or-a-manager](../business/shop/context_decision.md#a-write-needs-a-grant-or-a-manager)) | ask for the shop to be granted to you |
| *N of this file's orders belong to …* | one order in another shop refuses the whole file ([a-file-with-another-shops-orders-is-refused](../business/settlement/settlement_importer_decision.md#a-file-with-another-shops-orders-is-refused)) | choose the shop the statement was downloaded from |
| *This is not a Shopee statement* (or TikTok) | the file is another marketplace's, or not a statement | the right shop, or download it again |

Then import the same file again: a row already posted reads *already there*, never twice
([the-row-key-is-the-only-dedupe](../business/settlement/settlement_importer_decision.md#the-row-key-is-the-only-dedupe)).
A **held** row is not a refusal — the file ran and that row waits. The whole flow:
[rpc.md](../services/settlement_importer_service/rpc.md#one-import).
