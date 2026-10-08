# Development state — mcp

**Pass:** business analysis of the owner's [mcp/context.md](../../business/mcp/context.md) — a local MCP app shipped
to users, so their own AI agent can read and analyze their data through the RPC API. Questions:
[context_clarify.md](../../business/mcp/context_clarify.md) — **6 open** (Q3–Q8). Decisions:
[context_decision.md](../../business/mcp/context_decision.md) — **four**. The lifecycle is at *waiting for the owner*,
⛔ **blocked on Q8**; no Storybook prototype, no proto, no code.

## Decided

| decision | what it means for the build |
| --- | --- |
| [an-agent-only-reads-for-now](../../business/mcp/context_decision.md#an-agent-only-reads-for-now) *(Q1)* | an agent runs **no write**, destructive or not · the **server** refuses it — the access interceptor, before the handler, on an agent's credential · a read is an RPC declared `idempotency_level = NO_SIDE_EFFECTS` (my spec — no proto carries it yet) · tools listed with `readOnlyHint: true` · rules out the session token as the agent's credential |
| [the-mcp-uses-the-official-go-sdk](../../business/mcp/context_decision.md#the-mcp-uses-the-official-go-sdk) *(owner's §General 3)* | every MCP piece on `modelcontextprotocol/go-sdk`, the version `go.mod` pins (v1.7.0, shared with `san remote`) · it issues no token, so any OAuth login is ours to build · ⚠ its localhost guard 403s a loopback request with a public `Host` |
| [the-tools-live-in-the-shipped-app](../../business/mcp/context_decision.md#the-tools-live-in-the-shipped-app) *(Q2a — against my B)* | option A: a Go app on the user's machine, MCP over stdio (`StdioTransport`), calling our Connect RPCs over HTTPS with the agent's credential · tools compiled in · **no `/mcp` on our server** · accepts that a breaking RPC change breaks un-updated copies |
| [chatgpt-and-claude-are-the-agents-for-now](../../business/mcp/context_decision.md#chatgpt-and-claude-are-the-agents-for-now) *(Q2b)* | ChatGPT reaches only a public HTTPS URL, OAuth or no auth, never stdio · Claude: custom connectors are public URLs called from Anthropic's cloud (OAuth), and Claude Desktop / Claude Code also run a local stdio program |

⛔ **The last two conflict** — ChatGPT cannot reach the shipped app. Recorded as a contradiction in the clarify
([the shipped app cannot reach ChatGPT](../../business/mcp/context_clarify.md#the-shipped-app-cannot-reach-chatgpt))
and asked as Q8. My recommendation: C — our server hosts the MCP behind an OAuth login.

## What exists

| | |
| --- | --- |
| a user-facing MCP | **nothing** — no service, no proto option, no screen, no shipped app |
| `san remote mcp` | the **developer** MCP (shell + files of the checkout, `tools/san/remote/`) — unrelated; must not be extended into this, and nothing of it is ever shipped. Its tunnel + `--public-url` shape is option "A + a tunnel per user" in Q8 |
| the only credential | the 24h session JWT — **no per-token revocation** (logout drops the role cache only; a password reset stops only `CheckAccess` renewal), and it carries every write |
| read markers | none — no proto has `idempotency_level`, and `request_policy` names roles, not read/write |

## Proposed, not decided (all in the clarify)

| | |
| --- | --- |
| reaching ChatGPT | C: a hosted MCP endpoint behind an OAuth login that mints the agent's credential — reverses A (Q8) |
| offered to agents | a read is callable with an agent key only if its request also carries a new `(warehouse.agent.v1.tool)` option; boot fails on the option over a non-read (Q6) |
| the credential | `agent_keys` in `user_service` — hashed, named, one team, expiring, revocable, `last_used_at`; never the root bypass (Q3, Q4) |
| who | team owner and admin; CS and staff only if the owner allows (Q5) |
| first tools | the 11 existing aggregate RPCs + a product search + an order by marketplace ref; a per-key rate limit (Q6) |
| buyer data | `customer_name`, `customer_phone`, address cleared by our server for an agent's credential (Q7) |
| screens | `/profile` → AI agents (create, show once, revoke via `ConfirmDialog`); the team's settings for the owner |

## Pick up here

Wait for the owner on **Q8**. Do not start a prototype before it: A's first screen is a key page plus a local app's
setup, C's is an OAuth consent page — they share only the list of connected agents.
