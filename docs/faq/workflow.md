# FAQ — Working on the project

The development flow, branching, and which docs a change has to carry with it.

---

## Which branch do I commit to? Do I open a PR per task?

**No branch per issue, no PR per issue.** All work goes on the single long-lived **`dev`** branch,
committed straight. The owner keeps `dev` checked out to preview the running app, so per-issue
branch switching just gets in the way.

`main` is promoted from `dev` **only when the owner asks**. Never push `main`, never merge to it
unasked, never force-push it.

---

## How does work get done here?

Follow **[../development_lifecycle.md](../development_lifecycle.md)** — that is the development flow.

1. The owner defines a requirement — business in `docs/business/<big>/<small>.md`, technical in
   `docs/technical/<big>/<small>.md`.
2. An agent analyses it. Anything unclear becomes a question in a **`<small>_clarify.md`** beside the
   doc, and waits for the owner — it is never guessed at.
3. **Implementation analysis is frontend-first**: pages and components are built in Storybook with
   mock wiring, so the screen can be previewed before any backend exists.
4. Full implementation, then tests.
5. The pass ends by writing **`docs/development_state/<big>/<small>.md`** — the state summary the
   next agent reads to get oriented.

When the owner answers, record the answer in **`<small>_decision.md`** beside the doc *before* acting
on it. A decision that lives only in chat gets re-litigated by the next agent.

> There is no GitHub project board and no per-issue board dance any more — the lifecycle replaced it.

---

## What has to be green before I commit?

```sh
cd proto     && buf lint
go build ./... && go vet ./... && go test ./...     # from the REPO ROOT — see backend.md
cd frontend  && npm run typecheck
cd frontend  && npm run lint:mermaid                # if you touched any mermaid diagram
```

Plus the Playwright spec for the work in hand — not the whole suite, CI covers the rest.

---

## Which docs must I update in the same commit as my change?

Not "later", not "in a follow-up" — the same commit. A doc that lags is a doc nobody trusts.

| If you changed | Update |
| --- | --- |
| a migration / the schema | [../database-schema.md](../database-schema.md) — the service's `erDiagram` |
| an RPC with a non-trivial or cross-service flow | `docs/services/<service>/rpc.md`, with a mermaid sequence |
| `tools/san` | [../tools/san.md](../tools/san.md) — a row in Commands + its own section |
| a shared frontend component | its `<Component>.stories.tsx` beside it |
| anything that answers a question people keep asking | **this FAQ** |

Simple single-table CRUD RPCs need no `rpc.md` entry.

---

## Where do I write a design idea?

| Path | What it is | Can I build from it? |
| --- | --- | --- |
| `docs/business/<ctx>/<slice>.md` | the owner's business truth, **owner-written** | it is what a design must satisfy |
| `docs/technical/<ctx>/<slice>.md` | the owner's technical design, **owner-written** | yes — this is the design |
| `<slice>_clarify.md` | **your** critique, questions and proposed design for that doc | No — it is a question set, not an answer |
| `<slice>_decision.md` | what the owner decided, recorded by you, append-only | **Yes — a recorded decision is settled** |
| `guidelines/` | programmer-authoritative service + code guidelines | **Yes** |
| `docs/development_state/<ctx>/<slice>.md` | how far this slice has got — written for the next agent | as orientation, not as truth |

---

## Can I edit one of the owner's requirement docs?

**No — a doc in `docs/business/` or `docs/technical/` belongs to the owner.** Not a heading, not a
typo, not a broken diagram.

You may create exactly two files beside it, and nothing else:

```
docs/technical/ledger/mutation_and_ledger.md           ← the owner's. READ-ONLY.
docs/technical/ledger/mutation_and_ledger_clarify.md   ← your critique, questions, proposals.
docs/technical/ledger/mutation_and_ledger_decision.md  ← what the owner decided. Append-only.
```

Something wrong in the owner's file is **reported in the `_clarify.md`, naming the line — never fixed
by editing**. `_clarify.md` is the current open set, so an answered point is deleted from it once its
answer is recorded in `_decision.md`.

---

## Can I copy a model / screen / enum from the other repos on this machine?

**No.** The sibling repos under `d:\pdcgo` are not a design input. Do not read them, cite them, or
port their models, status enums, service boundaries or screens — unless the owner explicitly asks
for that reference in the current message.

"That's how the existing system does it" is not an argument here. Argue from what physically
happens in the warehouse, who the person is, what the business must know, and the trade-offs of the
option itself. The point of building new is to escape an accumulated design, not re-derive it.

---

## I hit a genuine design fork. Do I just pick one?

**No.** Put it in the `_clarify.md` beside the doc that can answer it as options with trade-offs, say which you
would pick, and **ask**. Recommend, then let the owner decide.

---

## This repo is public. What does that change?

Keep credentials, secrets, and the names of unrelated internal systems out of **everything
committed** — code, comments, docs, commit messages. Development credentials that are deliberately
public (the compose file, `seed dev`) are the documented exception.

---

## How do I let another AI agent work on this checkout?

`go run ./tools/san remote` from the repo root. It serves this working tree — shell commands
**streamed** as they run, plus byte-exact file read/write — and prints a **fresh token minted for
that run**, which is the only thing authorizing a caller.

```sh
go run ./tools/san remote                     # loopback, prints the token once
```

It serves **two faces on one port**, and which you want depends on the agent:

| | For | |
| --- | --- | --- |
| **Connect RPC** | a client we write | Streamed output, frame by frame |
| **MCP**, at `/mcp` | a client we did **not** write — Claude Web, a browser agent, someone else's harness | No code on the far side. See [the next question](#how-do-i-let-claude-on-the-web-work-on-my-local-checkout) |

Hand the token to the agent and nothing else; stopping the server ends the access. Full flags,
error codes and the RPC shapes are in [docs/tools/san.md](../tools/san.md#remote).

**Things worth knowing before you do it:**

- ⚠ **It is not a sandbox.** Whoever holds the token runs whatever you can run. The workspace root
  stops a mistyped path, not a determined caller — the command can `cd` anywhere.
- It binds to **loopback** by default. Reaching it from another machine should be an SSH tunnel,
  not `--addr 0.0.0.0`, and the banner says so loudly if you do the latter.
- Every command the agent runs is printed on **your** terminal. That visibility is half the deal.
- It needs **no database** — the only `san` command that never asks Local/Production.

---

## How do I let Claude on the web work on my local checkout?

Serve the checkout with a tunnel in front of it, and connect to the **MCP endpoint** — a hosted
client cannot reach `127.0.0.1`, and will not grow a client for our proto contract either.

```sh
# terminal 1 — MCP only, TOLD that a tunnel is in front of it
go run ./tools/san remote mcp --public-url https://devel.example.com

# terminal 2 — the tunnel
cloudflared tunnel --url http://127.0.0.1:8099        # or: ngrok http 8099
```

`remote mcp` serves the MCP endpoint and **nothing else** — no Connect RPCs, no gRPC reflection.
That address is deliberately reachable from the internet, and a hosted agent cannot call an RPC
anyway, so publishing one there is a surface with no user. Use plain `san remote` when you want
both faces locally.

The banner then prints the URL to paste into the client's connector box. It **contains the token**,
because a hosted client has a URL field and nowhere to type a header:

```
https://devel.example.com/mcp/<the token>
```

⚠ **`--public-url` is not optional here.** Without it every MCP request comes back **403** and
nothing says why: the MCP SDK rejects a request that *arrives on loopback* carrying a *non-loopback
`Host`* — which is the exact shape of every tunnelled request. Naming the public URL is how you
tell the server that shape is expected.

⚠ **That URL is a shell on your machine for anyone who reads it** — a screenshot, browser history,
your tunnel provider's access log. It dies when you Ctrl-C the server; bound it further with
`--token-ttl 4h`. A client that *can* send headers (Claude Code, Claude Desktop, Cursor) should use
`Authorization: Bearer <token>` against `http://127.0.0.1:8099/mcp` instead, with no tunnel at all.

The four tools, the truncation rule and the errors are in
[docs/tools/san.md](../tools/san.md#remote-mcp).

---

## Why does `san remote` have its own token instead of a normal login?

The caller is a program, not a person with roles in a team, so there is no identity to carry and no
role to look up — and minting a fake user would put a shell behind the credential the login screen
also accepts.

It is also the only thing that makes streaming work. The access interceptor
[refuses every streaming RPC](../../backend/services/user_service/access_interceptors/interceptor.go)
because it reads team scope from the request **body**, which has not arrived when an interceptor
runs. A bearer token is a **header** — present before the first message — so `remote`'s own
interceptor guards unary and streaming calls alike.

---

## Why can't `san remote` just be a service in `backend/services/`?

Because a shell must never be mountable into the process serving customers, and
`backend/services/*` is exactly the tree `service_api.go` wires from. Keeping it at
[tools/san/remote/](../../tools/san/remote/) makes that structural rather than a rule someone has
to remember — mounting it on the app would need an import from `backend/` up into `tools/`.

This is a deliberate exception to HARD RULE 2, and the only one.
