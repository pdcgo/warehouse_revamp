# Decisions — `mcp/context.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later reversed is
renamed and its references grepped (RULE 12), never quietly edited away. The open set is
[context_clarify.md](./context_clarify.md).

| decision | what it decided | from | under review |
| --- | --- | --- | --- |
| [an-agent-only-reads-for-now](#an-agent-only-reads-for-now) | an AI agent reads and never writes — the server refuses any write made with an agent's credential | owner | [Q3](./context_clarify.md#question) — the credential · [Q6](./context_clarify.md#question) — which reads |
| [the-mcp-uses-the-official-go-sdk](#the-mcp-uses-the-official-go-sdk) | every MCP piece is built on the protocol's official Go SDK, whichever side it runs on | owner | ✅ the app's side — [the-tools-live-in-the-shipped-app](#the-tools-live-in-the-shipped-app) · [Q8](./context_clarify.md#question) may add the server's |
| [the-tools-live-in-the-shipped-app](#the-tools-live-in-the-shipped-app) | the tools live in the app shipped to users, which calls our RPC API — our server serves no MCP | owner | ⛔ [Q8](./context_clarify.md#question) — it cannot reach ChatGPT |
| [chatgpt-and-claude-are-the-agents-for-now](#chatgpt-and-claude-are-the-agents-for-now) | the agents to serve, for now, are ChatGPT and Claude | owner | ⛔ [Q8](./context_clarify.md#question) — ChatGPT cannot reach the shipped app |

## an-agent-only-reads-for-now

> Chat *(owner, 2026-09-29)* — *"for 1, for now, agent only read, cannot run destructive action"*, to
> [Q1](./context_clarify.md#question) — read-only, as recommended.

**The verdict.** For now, an agent connected through the MCP **only reads**. It runs no write at all: none of the
destructive ones your answer names (cancel, delete, a stock adjustment), and none of the harmless-looking ones
either (a draft, a note), since *only read* excludes both. ⚠ My reading of *cannot*: **the server refuses the call**.
A tool list that simply leaves writes out is not *cannot*, because anyone holding the credential can call the API
directly, around the MCP.

```mermaid
flowchart TD
  C["a call made with an agent's credential"] --> R{"is the RPC a read"}
  R -->|"no — any write"| N["refused before the handler runs"]
  R -->|"yes"| A["the usual check — a role in the team"]
  A --> H["the handler, exactly as a screen's call"]
  S["a call made with a person's session — a screen"] --> A
```

### The spec

| | |
| --- | --- |
| what counts as a read | ⚠ my spec: an RPC declared `option idempotency_level = NO_SIDE_EFFECTS;` — the standard proto marker. **No proto carries it today**, so each read is marked as it is offered to agents |
| where it is enforced | the access interceptor, on every call: an agent's credential on an RPC not so declared → `PermissionDenied`, before the handler runs. A person's session is unaffected |
| a read with a side effect | is not a read, and stays unmarked — `CheckAccess` renews a token · beside settlement's report reads, `AnalyticReplayCompute` rebuilds the reports and `AnalyticMaintenanceRun` prunes a table |
| what the agent is told | every tool is listed with MCP's `readOnlyHint: true`. A hint that lets the agent skip asking the person, never the enforcement |
| *for now* | a write later is its own decision, RPC by RPC, with the person confirming in the agent before it runs. Nothing is built to anticipate one |

### What it does NOT settle

- **The credential** — [Q3](./context_clarify.md#question). ⚠ But this rules out the session token: it carries every
  write the person may make, so the agent needs a credential of its own.
- **Which reads** — every read, or only those offered as tools: [Q6](./context_clarify.md#question).
- **Whose data** — one team per credential, and the root bypass: [Q4](./context_clarify.md#question).
- ⚠ **Reading is not harmless.** This limits what an agent can *do*, not what it can *send*: every row it reads goes
  to its provider. That is still [Q5](./context_clarify.md#question) and [Q7](./context_clarify.md#question).

## the-mcp-uses-the-official-go-sdk

> `context.md` §General 3 *(owner, 2026-09-29)* — *"we use `https://github.com/modelcontextprotocol/go-sdk`"*.

> 🔄 *(2026-09-29, later)* [the-tools-live-in-the-shipped-app](#the-tools-live-in-the-shipped-app) put the tools in
> the shipped app: the piece used is `StdioTransport`, and there is no `/mcp` for `auth.RequireBearerToken` to guard —
> our access interceptor checks the credential. [Q8](./context_clarify.md#question) may bring `/mcp` back.

**The verdict.** Every MCP piece of this context is built on the protocol's official Go SDK, whichever side it runs
on. It is already a dependency: [go.mod](../../../go.mod) pins it at v1.7.0 for `san remote mcp`.

```mermaid
flowchart LR
  SDK["modelcontextprotocol/go-sdk v1.7.0"] -->|"StdioTransport"| A["an MCP server inside a local app"]
  SDK -->|"StreamableClientTransport"| B["a thin app forwarding to our server"]
  SDK -->|"NewStreamableHTTPHandler, auth.RequireBearerToken"| C["/mcp on our server, checking the key"]
```

### The spec

| | |
| --- | --- |
| the module | `github.com/modelcontextprotocol/go-sdk`, one version for the whole repo — the one `go.mod` pins. An upgrade for `san remote` is an upgrade for this, and the reverse |
| what it gives | both transports — stdio for a program on the user's machine, Streamable HTTP for an endpoint on ours — and the client side a thin app forwards with. **It builds every option in [Q2](./context_clarify.md#question), so it does not answer Q2** |
| auth | `auth.RequireBearerToken` checks a bearer on `/mcp` — enough for an agent key ([Q3](./context_clarify.md#question)). **It issues no token**: its OAuth code is for clients and for checking a token, so a login for web agents is a server of ours |
| ⚠ its localhost guard | a request arriving on a loopback address with a non-loopback `Host` is refused with 403 — what `san remote` met behind a tunnel ([san.md](../../tools/san.md#putting-a-tunnel-in-front)). A proxy on the same host in front of `/mcp` would meet it too; `DisableLocalhostProtection` is the switch |
| shared with `san remote` | the library only — never code, never tools ([Contradiction](./context_clarify.md#contradiction)) |

### What it does NOT settle

- **Which protocol crosses to us, and so where the tools live** — [Q2](./context_clarify.md#question). The SDK builds
  every option alike.

## the-tools-live-in-the-shipped-app

> Chat *(owner, 2026-09-29)* — *"for 2a, we use A"*, to [Q2](./context_clarify.md#question) — against my
> recommendation, B. ⛔ It conflicts with [chatgpt-and-claude-are-the-agents-for-now](#chatgpt-and-claude-are-the-agents-for-now),
> decided in the same message — [Q8](./context_clarify.md#question).

**The verdict.** The MCP's tools live in the app shipped to users. It runs on the user's machine, speaks MCP to the
agent over stdio, and calls our RPC API directly — the way the web app does. Our server serves **no** MCP endpoint:
it stays Connect RPC only.

```mermaid
flowchart LR
  AG["the agent, on the same machine"] -->|"MCP, stdio"| APP["the shipped app — the tools"]
  APP -->|"our RPC API, HTTPS + the agent's credential"| I["access interceptor"]
  I --> H["the RPC handlers"]
```

### The spec

| | |
| --- | --- |
| the app | a Go program on [the-mcp-uses-the-official-go-sdk](#the-mcp-uses-the-official-go-sdk) — `StdioTransport` — started by the agent |
| its calls | Connect RPCs over HTTPS, the agent's credential ([Q3](./context_clarify.md#question)) as the bearer — through the same interceptor as a screen's call, so [an-agent-only-reads-for-now](#an-agent-only-reads-for-now) holds unchanged |
| its tools | compiled in — the RPCs offered to agents ([Q6](./context_clarify.md#question)), read from the descriptors linked into the binary |
| our server | no `/mcp`, and no MCP dependency |
| ⚠ what it accepts | every installed copy speaks our proto contract: a breaking RPC change breaks every user who has not updated · a new tool reaches a user only in a new app · a build per OS |
| ⚠ what it reaches | an agent that starts a local program — Claude Desktop, Claude Code. **Not ChatGPT, and not Claude in a browser or on a phone** |

### What it does NOT settle

- ⛔ **ChatGPT** — it cannot reach the app: [Q8](./context_clarify.md#question).
- **How an old copy learns it is old** — whether the server refuses an outdated app, and how the user gets the new one.
- **How the app reaches a user** — a download, or a Claude Desktop extension.

## chatgpt-and-claude-are-the-agents-for-now

> Chat *(owner, 2026-09-29)* — *"for 2b for now we use chatgpt and claude"*, to [Q2](./context_clarify.md#question).
> ⛔ It conflicts with [the-tools-live-in-the-shipped-app](#the-tools-live-in-the-shipped-app) — [Q8](./context_clarify.md#question).

**The verdict.** For now, the agents the MCP has to serve are **ChatGPT** and **Claude**. Checked against both
vendors' docs (2026-09-29), they reach an MCP server in different ways:

```mermaid
flowchart LR
  CG["ChatGPT — web, desktop, phone"] -->|"a public HTTPS URL, OAuth or none"| R["a remote MCP server"]
  CL["Claude — web, Desktop, phone"] -->|"a public HTTPS URL, called from Anthropic, OAuth"| R
  CD["Claude Desktop, Claude Code"] -->|"a local program, stdio"| L["a local MCP app"]
```

### The spec

| | |
| --- | --- |
| ChatGPT | a remote server only — SSE or streaming HTTP at a public HTTPS URL, logged in with OAuth or with nothing. No stdio, and nowhere to paste a key ([OpenAI — developer mode](https://developers.openai.com/api/docs/guides/developer-mode)) |
| Claude | a *custom connector* on every surface — a public URL called from Anthropic's cloud, even from Claude Desktop, logged in with OAuth ([Claude — custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)) · Claude Desktop and Claude Code can also start a local program over stdio |
| *for now* | another agent later is a new decision |

### What it does NOT settle

- ⛔ **How ChatGPT is reached** — the shipped app cannot be: [Q8](./context_clarify.md#question).
