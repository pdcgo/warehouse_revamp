# Development state — mcp

**Pass:** business analysis of the owner's [mcp/context.md](../../business/mcp/context.md) — a local MCP app shipped
to users, so their own AI agent can read and analyze their data through the RPC API. Questions:
[context_clarify.md](../../business/mcp/context_clarify.md) — **6 open** (Q2–Q7). Decisions:
[context_decision.md](../../business/mcp/context_decision.md) — **one**. The lifecycle is at *waiting for the owner*;
no Storybook prototype, no proto, no code.

## Decided

| decision | what it means for the build |
| --- | --- |
| [an-agent-only-reads-for-now](../../business/mcp/context_decision.md#an-agent-only-reads-for-now) *(Q1)* | an agent runs **no write**, destructive or not · the **server** refuses it — the access interceptor, before the handler, on an agent's credential · a read is an RPC declared `idempotency_level = NO_SIDE_EFFECTS` (my spec — no proto carries it yet) · tools listed with `readOnlyHint: true` · rules out the session token as the agent's credential |

## What exists

| | |
| --- | --- |
| a user-facing MCP | **nothing** — no service, no proto option, no screen, no shipped app |
| `san remote mcp` | the **developer** MCP (shell + files of the checkout, `tools/san/remote/`) — unrelated; must not be extended into this, and nothing of it is ever shipped |
| the MCP SDK | `github.com/modelcontextprotocol/go-sdk` v1.7.0 is already in `go.mod` (used by `san remote`) |
| the only credential | the 24h session JWT — **no per-token revocation** (logout drops the role cache only; a password reset stops only `CheckAccess` renewal), and it carries every write |
| read markers | none — no proto has `idempotency_level`, and `request_policy` names roles, not read/write |

## Proposed, not decided (all in the clarify)

| | |
| --- | --- |
| offered to agents | a read is callable with an agent key only if its request also carries a new `(warehouse.agent.v1.tool)` option; boot fails on the option over a non-read (Q6) |
| where the tools live | server-side `/mcp`, each tool call a real Connect call through the access interceptor; the shipped app a thin bridge (Q2) |
| the credential | `agent_keys` in `user_service` — hashed, named, one team, expiring, revocable, `last_used_at`; never the root bypass (Q3, Q4) |
| who | team owner and admin; CS and packer only if the owner allows (Q5) |
| first tools | the 11 existing aggregate RPCs + a product search + an order by marketplace ref; a per-key rate limit (Q6) |
| buyer data | `customer_name`, `customer_phone`, address cleared by a field option before anything leaves (Q7) |
| screens | `/profile` → AI agents (create, show once, revoke via `ConfirmDialog`); the team's settings for the owner |

## Pick up here

Wait for the owner on **Q2** — where the tools live, and which agents the users use. Do not start a prototype before
it: it decides whether the first screen is a key page (desktop bridge) or an OAuth consent page (web agents).
