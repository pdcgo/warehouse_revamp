// user_service's AgentService as Storybook's stub — the AI agents a person connects to read a team through our MCP
// (docs/business/mcp/context_decision.md). It plays the decided rules, so a story that passes asserts on them:
//
//   - a client is known only with a redirect it registered (AgentClientDetail refuses anything else);
//   - every team (0) is Root's and the root team's Administrator's (a-roots-agent-reads-every-team);
//   - CS and staff connect only once the team's owner has turned it on (the-owner-decides-who-connects-an-agent);
//   - a person revokes only their own; the owner revokes any connection reading the team; root's every-team ones are not
//     on a team's list.
//
// Seeded: Ani (61, the signed-in identity) reads Toko Melati (12) from ChatGPT and every team from Claude; Dewi (64) reads
// Toko Melati from her phone; Eko (65) reads Toko Kenanga (13). Toko Kenanga's owner lets CS and staff connect; Toko
// Melati's and both warehouses' do not.
//
// WRITEABLE: a connect, a revoke and the switch are read back. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import type { AgentConnection, AgentService } from "../src/gen/warehouse/user/v1/agent_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { users } from "./fixtures";
import { sessionScenario } from "./sessionScenario";

/** The agents that registered — ChatGPT and Claude (chatgpt-and-claude-are-the-agents-for-now). */
export const agentClients = {
  chatgpt: { id: "chatgpt-connector", name: "ChatGPT", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" },
  claude: { id: "claude-connector", name: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" },
} as const;

const DAY = 86_400n;

type Row = Omit<AgentConnection, "$typeName" | "$unknown">;

const seed = (): Row[] => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const made = (daysAgo: bigint) => now - daysAgo * DAY;

  return [
    { id: 701n, userId: 61n, teamId: 12n, name: "ChatGPT, Ani's laptop", clientName: "ChatGPT", createdAtUnix: made(10n), expiresAtUnix: made(10n) + 90n * DAY, lastUsedAtUnix: now - 2n * 3600n },
    { id: 702n, userId: 61n, teamId: 0n, name: "Claude, weekly report", clientName: "Claude", createdAtUnix: made(3n), expiresAtUnix: made(3n) + 90n * DAY, lastUsedAtUnix: 0n },
    { id: 703n, userId: 64n, teamId: 12n, name: "ChatGPT, Dewi's phone", clientName: "ChatGPT", createdAtUnix: made(20n), expiresAtUnix: made(20n) + 90n * DAY, lastUsedAtUnix: now - DAY },
    { id: 704n, userId: 65n, teamId: 13n, name: "Claude", clientName: "Claude", createdAtUnix: made(5n), expiresAtUnix: made(5n) + 90n * DAY, lastUsedAtUnix: now - 3n * DAY },
  ];
};

const seedPolicy = (): Map<bigint, boolean> => new Map([[13n, true]]);

let table = seed();
let policy = seedPolicy();

/** What the last AgentConnect carried — what a story asserts Allow sent. */
export const agentScenario = {
  lastConnect: undefined as
    | undefined
    | { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: string; state: string; teamId: bigint; name: string },
};

export function resetAgentStub() {
  table = seed();
  policy = seedPolicy();
  agentScenario.lastConnect = undefined;
}

/** A `beforeEach`: the signed-in person has connected no agent. */
export function withNoAgentConnections() {
  table = table.filter((c) => c.userId !== me());
}

/** For a story: who made connection `id` — e.g. a former user, to show the card naming them (erase-keeps-the-row). */
export function agentConnectionByForStory(id: bigint, userId: bigint) {
  const row = table.find((c) => c.id === id);
  if (!row) throw new Error(`no agent connection ${id} in the stub`);
  row.userId = userId;
}

/** Whether the connection is still live — what a story asserts a revoke removed. */
export function agentConnectionExists(id: bigint): boolean {
  return table.some((c) => c.id === id);
}

/** Whether CS and staff of the team may connect — what a story asserts the switch wrote. */
export function membersMayConnect(teamId: bigint): boolean {
  return policy.get(teamId) ?? false;
}

/** The signed-in identity, as AuthService's CheckAccess stub names it. */
const me = () => users[0]!.id;

function clientOf(clientId: string, redirectUri: string) {
  const client = Object.values(agentClients).find((c) => c.id === clientId);

  if (!client) throw new ConnectError(`unknown agent client "${clientId}"`, Code.NotFound);
  if (client.redirectUri !== redirectUri) {
    throw new ConnectError("the redirect is not one this agent registered", Code.InvalidArgument);
  }

  return client;
}

function paged(rows: Row[], page: { page: number; limit: number } | undefined) {
  const limit = page?.limit || 10;
  const current = page?.page || 1;
  const slice = rows.slice((current - 1) * limit, current * limit);

  return {
    items: [{ d: { case: "connection" as const, value: { mapData: Object.fromEntries(slice.map((c) => [c.id.toString(), c])) } } }],
    ids: slice.map((c) => c.id),
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(rows.length / limit)), totalItems: BigInt(rows.length) },
  };
}

const newestFirst = (a: Row, b: Row) => (a.createdAtUnix === b.createdAtUnix ? 0 : a.createdAtUnix > b.createdAtUnix ? -1 : 1);

export const agentService: Partial<ServiceImpl<typeof AgentService>> = {
  agentClientDetail: (req) => ({ clientName: clientOf(req.clientId, req.redirectUri).name }),

  agentConnect: (req) => {
    const client = clientOf(req.clientId, req.redirectUri);
    const role = sessionScenario.role;
    const platform = role === Role.ROOT || role === Role.ADMINISTRATOR;

    if (req.teamId === 0n && !platform) {
      throw new ConnectError("only Root and the Administrator connect an agent to every team", Code.PermissionDenied);
    }
    if ((role === Role.SELLING_CS || role === Role.WAREHOUSE_STAFF) && !membersMayConnect(req.teamId)) {
      throw new ConnectError("the team's owner has not allowed members to connect agents", Code.PermissionDenied);
    }

    agentScenario.lastConnect = {
      clientId: req.clientId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
      state: req.state,
      teamId: req.teamId,
      name: req.name,
    };

    const now = BigInt(Math.floor(Date.now() / 1000));
    const id = table.reduce((max, c) => (c.id > max ? c.id : max), 700n) + 1n;
    table = [
      ...table,
      { id, userId: me(), teamId: req.teamId, name: req.name, clientName: client.name, createdAtUnix: now, expiresAtUnix: now + 90n * DAY, lastUsedAtUnix: 0n },
    ];

    return { redirectUrl: `${req.redirectUri}?code=stub-code-${id}&state=${encodeURIComponent(req.state)}` };
  },

  agentConnectionList: (req) => paged(table.filter((c) => c.userId === me()).sort(newestFirst), req.page),

  agentConnectionRevoke: (req) => {
    const row = table.find((c) => c.id === req.connectionId);
    if (!row || row.userId !== me()) throw new ConnectError("connection not found", Code.NotFound);

    table = table.filter((c) => c.id !== req.connectionId);
    return {};
  },

  // Root's every-team connections read every team and no team's owner may revoke them, so they are on no team's list.
  agentConnectionTeamList: (req) => paged(table.filter((c) => c.teamId === req.teamId).sort(newestFirst), req.page),

  agentConnectionTeamRevoke: (req) => {
    const row = table.find((c) => c.id === req.connectionId);
    if (!row || row.teamId !== req.teamId) throw new ConnectError("connection not found", Code.NotFound);

    table = table.filter((c) => c.id !== req.connectionId);
    return {};
  },

  teamAgentPolicyDetail: (req) => ({ membersMayConnect: membersMayConnect(req.teamId) }),

  teamAgentPolicySet: (req) => {
    policy.set(req.teamId, req.membersMayConnect);
    return { membersMayConnect: req.membersMayConnect };
  },
};
