import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, userClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { AgentConnection } from "../../gen/warehouse/user/v1/agent_pb";
import { teamAccessFromList, teamAccessRowData } from "../users/adapt";
import { connectionRowData, connectionsFromList } from "./adapt";

// The AI agents' reads and writes (docs/business/mcp/context_decision.md). Query hooks live beside the screens that use
// them, per the convention in api/queryClient.ts: the connect page, /profile's AI Agents and Settings' AI Agents.

/** A page of connections, and whether another page follows — what `GrowingPager` needs. */
export interface ConnectionPage {
  connections: AgentConnection[];
  hasNext: boolean;
}

// ── The connect page ────────────────────────────────────────────────────────────────────────────

/**
 * WHICH AGENT IS ASKING — its registered name, and the server's check that `redirectUri` is one it registered. An error
 * means the link is not one we can honour, and the page sends the browser NOWHERE: an unchecked redirect is how a consent
 * screen becomes somebody else's open redirect.
 */
export function useAgentClientDetail(args: { clientId: string; redirectUri: string; enabled: boolean }) {
  const { clientId, redirectUri, enabled } = args;

  return useQuery({
    queryKey: key.agents(undefined, { client: clientId, redirectUri }),
    enabled,
    // A refusal is an answer (NotFound, InvalidArgument), not a blip — asking twice only delays saying so.
    retry: false,
    queryFn: async () => (await agentClient.agentClientDetail({ clientId, redirectUri })).clientName,
  });
}

/**
 * THE PERSON'S MEMBERSHIPS — the teams the connect page offers. TeamProvider loads the same list, but the connect page
 * sits outside the app shell (no sidebar, no switcher), so it asks itself. Keyed on the person: two people signing in
 * one after the other in the same tab must not share an answer.
 */
export function useMyMemberships(userId: bigint | undefined) {
  return useQuery({
    queryKey: key.users(undefined, { memberships: userId?.toString() ?? "none" }),
    enabled: userId !== undefined,
    queryFn: async () => {
      // A large first page, as the team switcher asks: a person is in far fewer teams than the contract's 200.
      const res = await userClient.teamAccessList({ dataRequest: teamAccessRowData(), page: { page: 1, limit: 200 } });

      return teamAccessFromList(res.items, res.ids);
    },
  });
}

/** The person allows the agent: one-time code minted, and where to send the browser back to the agent. */
export function useAgentConnect() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      state: string;
      teamId: bigint;
      name: string;
    }) => (await agentClient.agentConnect({ ...vars, codeChallengeMethod: "S256" })).redirectUrl,
    onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
  });
}

// ── A person's own connections (/profile) ───────────────────────────────────────────────────────

/** MY live connections, newest first — revoked and expired ones read nothing and are not listed. */
export function useMyAgentConnections(args: { page: number; pageSize: number }) {
  const { page, pageSize } = args;

  return useQuery({
    queryKey: key.agents(undefined, { mine: true, page, pageSize }),
    ...listQuery,
    queryFn: async (): Promise<ConnectionPage> => {
      const res = await agentClient.agentConnectionList({
        dataRequest: connectionRowData(),
        page: { page, limit: pageSize },
      });

      return { connections: connectionsFromList(res.items, res.ids), hasNext: page < (res.pageInfo?.totalPage ?? 0) };
    },
  });
}

/** Revoke one of MY connections — it signs the person out of nothing else. */
export function useRevokeAgentConnection() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: bigint) => {
      await agentClient.agentConnectionRevoke({ connectionId });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
  });
}

// ── A team's connections and its policy (Settings, the owner's view) ────────────────────────────

/** EVERY live connection reading the team, whoever made it — its owner's view. */
export function useTeamAgentConnections(args: { teamId: bigint; page: number; pageSize: number }) {
  const { teamId, page, pageSize } = args;

  return useQuery({
    queryKey: key.agents(teamId, { team: true, page, pageSize }),
    ...listQuery,
    enabled: teamId > 0n,
    queryFn: async (): Promise<ConnectionPage> => {
      const res = await agentClient.agentConnectionTeamList({
        teamId,
        dataRequest: connectionRowData(),
        page: { page, limit: pageSize },
      });

      return { connections: connectionsFromList(res.items, res.ids), hasNext: page < (res.pageInfo?.totalPage ?? 0) };
    },
  });
}

/** The owner revokes any connection reading the team — a member's too. */
export function useRevokeTeamAgentConnection() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { teamId: bigint; connectionId: bigint }) => {
      await agentClient.agentConnectionTeamRevoke(vars);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
  });
}

/** Whether the team's CS and staff may connect an agent — off until the owner turns it on. */
export function useTeamAgentPolicy(args: { teamId: bigint | undefined; enabled?: boolean }) {
  const { teamId, enabled = true } = args;

  return useQuery({
    queryKey: key.agents(teamId, { policy: true }),
    enabled: enabled && teamId !== undefined && teamId > 0n,
    queryFn: async () => (await agentClient.teamAgentPolicyDetail({ teamId: teamId! })).membersMayConnect,
  });
}

export function useSetTeamAgentPolicy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { teamId: bigint; membersMayConnect: boolean }) =>
      (await agentClient.teamAgentPolicySet(vars)).membersMayConnect,
    onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
  });
}
