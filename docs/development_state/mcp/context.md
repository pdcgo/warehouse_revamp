# Development state — mcp

**Pass:** first business analysis of the owner's [mcp/context.md](../../business/mcp/context.md) — a local MCP app
shipped to users, so their own AI agent can read and analyze their data through the RPC API. Questions:
[context_clarify.md](../../business/mcp/context_clarify.md) — **7 open, none answered**. No `context_decision.md`
yet. The lifecycle is at *waiting for the owner*; no Storybook prototype, no proto, no code.

## Decided

Nothing.

## What exists

| | |
| --- | --- |
| a user-facing MCP | **nothing** — no service, no proto option, no screen, no shipped app |
| `san remote mcp` | the **developer** MCP (shell + files of the checkout, `tools/san/remote/`) — unrelated; must not be extended into this, and nothing of it is ever shipped |
| the MCP SDK | `github.com/modelcontextprotocol/go-sdk` v1.7.0 is already in `go.mod` (used by `san remote`) |
| the only credential | the 24h session JWT — **no per-token revocation** (logout drops the role cache only; a password reset stops only `CheckAccess` renewal). Unfit for an agent: see critique 3 |
| read markers | none — no proto has `idempotency_level`, and `request_policy` names roles, not read/write |

## Proposed, not decided (all in the clarify)

| | |
| --- | --- |
| read-only | an agent key may call an RPC only if it is `NO_SIDE_EFFECTS` **and** its request carries a new `(warehouse.agent.v1.tool)` option; boot fails on the option over a non-read RPC (Q1) |
| where the tools live | server-side `/mcp`, each tool call a real Connect call through the access interceptor; the shipped app a thin bridge (Q2) |
| the credential | `agent_keys` in `user_service` — hashed, named, one team, expiring, revocable, `last_used_at`; never the root bypass (Q3, Q4) |
| who | team owner and admin; CS and packer only if the owner allows (Q5) |
| first tools | the 11 existing aggregate RPCs + a product search + an order by marketplace ref; a per-key rate limit (Q6) |
| buyer data | `customer_name`, `customer_phone`, address cleared by a field option before anything leaves (Q7) |
| screens | `/profile` → AI agents (create, show once, revoke via `ConfirmDialog`); the team's settings for the owner |

## Pick up here

Wait for the owner on **Q1 and Q2** — everything else follows from them. Do not start a prototype before Q2: it
decides whether the first screen is a key page (desktop bridge) or an OAuth consent page (web agents).
