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
