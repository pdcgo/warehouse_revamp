# Development state — mcp

> ✅ **2026-11-02 — built.** Our server hosts the MCP at `/mcp` behind our own OAuth
> ([our-server-hosts-the-mcp](../../business/mcp/context_decision.md#our-server-hosts-the-mcp)); an agent's credential is
> its own, read-only, one team (or every team for root), 90 days, revocable. Every decision in
> [context_decision.md](../../business/mcp/context_decision.md) carries a *Built* note with its build details.

## What exists

| | |
| --- | --- |
| contract | `warehouse.user.v1.AgentService` ([agent.proto](../../../proto/warehouse/user/v1/agent.proto)) — 8 RPCs. The read marker: `option idempotency_level = NO_SIDE_EFFECTS` on `MetricSearch`/`MetricData` (order, settlement, supplier), `ProductList`, `OrderByExternalRefs`, `OrderDetail`, `LiabilityPositionList`, `TeamList`, `TeamByIds` |
| schema | user_service `00011` — `agent_oauth_clients`, `agent_oauth_codes`, `agent_credentials`, `team_agent_policies` ([database-schema.md](../../database-schema.md#user_service)) |
| enforcement | `access_interceptors` — a `wha_` bearer goes to `AgentVerifier` (`agent_credentials.Store`), only a marked read passes, and step 6b holds it to its team (or to root's bypass, while held). `WithAgentVerifier` option; `AgentGrantFrom(ctx)` |
| OAuth | `user_service/agent_oauth` — discovery, `/oauth/register`, `/oauth/authorize` → the app's `/connect-agent`, `/oauth/token` (PKCE S256, no refresh) |
| the endpoint | `backend/services/mcp_service` — stateless Streamable HTTP, `auth.RequireBearerToken`, six read-only tools calling our RPCs at `INTERNAL_BASE_URL` with the agent's bearer; 120 calls/min, burst 20, per connection per instance |
| config | `PUBLIC_URL` (the API as an agent sees it), `APP_URL` (the connect page's host) — both default to localhost; a non-loopback `PUBLIC_URL` turns off the SDK's localhost guard |
| screens | `/connect-agent` (outside the shell, `pages/connect-agent`), /profile → AI Agents (`AgentConnectionsCard`, with the connector URL to copy), Settings → AI Agents (`TeamAgentsCard`: the owner's switch and list); `features/agents` holds the hooks and the shared row. Stories: `Pages/Agents/ConnectAgent`, `Pages/Profile/AgentConnectionsCard`, `Pages/Settings/TeamAgentsCard`, `Pages/Login`, `Features/Agents/AgentConnectionRow` |
| docs | [docs/services/mcp_service/rpc.md](../../services/mcp_service/rpc.md), [user_service rpc.md](../../services/user_service/rpc.md#connecting-an-ai-agent--oauth-then-its-own-credential), CLAUDE.md's roling rules |

```sh
go test ./backend/services/user_service/... ./backend/services/mcp_service/...
```

Smoke-tested end to end against a running server on the test database (2026-11-02): discovery → register → sign in →
authorize → connect (root, every team) → token → an agent's write refused → initialize → all six tools → revoke →
the next call a 401.

## ⚠ Build details the owner has not seen

| | |
| --- | --- |
| `list_teams` | a sixth tool beside the decided five — root's every-team connection needs team ids |
| root's connections | not listed on a team's owner list, and no team owner may revoke them |
| unscoped reads | a one-team credential may call an unscoped `allow_only_authenticated` read (`TeamByIds` — names by id), as a handler forwarding its bearer does |
| the rate | 120/min, burst 20 — no number was decided |
| the connect page | no team preselected unless there is one; a link missing its PKCE or redirect is refused before any call; root also sees team 1 as a single team beside *Every team* |
| the settings card | the owner, root and the administrator only — the team Admin may connect but does not see the team's list (its RPCs are the owner's) |
| sign-in | now returns to the page it was sent from (`state.from` = path + query), so signing back in no longer always lands on `/` |

## Not built

| | |
| --- | --- |
| a refresh token | by design — 90 days, then connect again |
| a cross-instance rate limit | per instance today; a shared limiter (Redis) when there is more than one |
| a dev tunnel recipe | connecting the real ChatGPT/Claude needs `PUBLIC_URL` on a public HTTPS tunnel to :8080 and `APP_URL` to the UI — not scripted |
