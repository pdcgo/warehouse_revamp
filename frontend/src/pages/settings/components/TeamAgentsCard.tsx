import { useState } from "react";
import { Alert, Card, Heading, Separator, Skeleton, Stack, Switch, Text } from "@chakra-ui/react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../../api/clients";
import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { toaster } from "../../../components/feedback/Toaster";
import { AgentConnectionRow } from "../../../features/agents/AgentConnectionRow";
import {
  useRevokeTeamAgentConnection,
  useSetTeamAgentPolicy,
  useTeamAgentConnections,
  useTeamAgentPolicy,
} from "../../../features/agents/queries";
import { useActors } from "../../../features/users/queries";

const PAGE_SIZE = 10;

export interface TeamAgentsCardProps {
  /** The team whose agents these are — the current team. */
  teamId: bigint;
}

// THE TEAM'S AI AGENTS, for its OWNER (the-owner-decides-who-connects-an-agent). Connecting an agent sends the team's data
// — the buyers' names, phones and addresses included (buyer-data-reaches-the-agent) — to the agent's provider, so it is
// the owner's decision: the owner and admins may connect one, CS and staff only once the switch here is on. Under it,
// every connection reading the team, whoever made it, each revocable.
//
// Shown only to the owner, Root and the Administrator — the policies on the three RPCs it calls (canOverseeTeamAgents).
export function TeamAgentsCard({ teamId }: TeamAgentsCardProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const policy = useTeamAgentPolicy({ teamId });
  const setPolicy = useSetTeamAgentPolicy();

  const query = useTeamAgentConnections({ teamId, page, pageSize: PAGE_SIZE });
  const revoke = useRevokeTeamAgentConnection();

  const connections = query.data?.connections ?? [];
  // Who connected each — read live by id, as every history names its people (useActors).
  const people = useActors(connections.map((c) => c.userId));

  function personName(userId: bigint): string {
    const person = people.data?.get(userId.toString());

    return t("agents.team.connectedBy", { name: person?.name || person?.username || `#${userId}` });
  }

  async function flip(membersMayConnect: boolean) {
    try {
      await setPolicy.mutateAsync({ teamId, membersMayConnect });
      toaster.create({
        type: "success",
        title: membersMayConnect ? t("agents.team.membersOn") : t("agents.team.membersOff"),
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("agents.team.policyFailed"), description: rpcError(err) });
    }
  }

  return (
    <Card.Root data-testid="settings-agents">
      <Card.Body>
        <Stack gap="card">
          <Stack gap="1">
            <Heading size="sm">{t("agents.title")}</Heading>
            <Text color="fg.muted" fontSize="xs">
              {t("agents.team.hint")}
            </Text>
          </Stack>

          {policy.isPending ? (
            <Skeleton h="6" w="60%" />
          ) : policy.isError ? (
            <Alert.Root status="error" data-testid="settings-agents-policy-error">
              <Alert.Indicator />
              <Alert.Title>{rpcError(policy.error)}</Alert.Title>
            </Alert.Root>
          ) : (
            <Switch.Root
              checked={policy.data}
              disabled={setPolicy.isPending}
              onCheckedChange={(e) => void flip(!!e.checked)}
              data-testid="settings-agents-members"
            >
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>{t("agents.team.membersMayConnect")}</Switch.Label>
            </Switch.Root>
          )}

          <Separator />

          <Stack gap="1">
            <Text fontSize="sm" fontWeight="bold">
              {t("agents.team.listTitle")}
            </Text>
            <Text color="fg.muted" fontSize="xs">
              {t("agents.team.listHint")}
            </Text>
          </Stack>

          {query.isPending ? (
            <ListSkeleton rows={2} />
          ) : query.isError ? (
            <Alert.Root status="error" data-testid="settings-agents-error">
              <Alert.Indicator />
              <Alert.Title>{rpcError(query.error)}</Alert.Title>
            </Alert.Root>
          ) : connections.length === 0 ? (
            <EmptyHint
              size="sm"
              icon={Bot}
              title={t("agents.team.emptyTitle")}
              description={t("agents.team.emptyHint")}
              testId="settings-agents-empty"
            />
          ) : (
            <RefreshOverlay busy={query.isFetching && !query.isPending}>
              <Stack gap="0" separator={<Separator />}>
                {connections.map((connection) => (
                  <AgentConnectionRow
                    key={connection.id.toString()}
                    connection={connection}
                    context={personName(connection.userId)}
                    revoke={async () => {
                      await revoke.mutateAsync({ teamId, connectionId: connection.id });
                    }}
                  />
                ))}
              </Stack>
            </RefreshOverlay>
          )}

          {!query.isPending && !query.isError && (
            <GrowingPager
              page={page}
              onPageChange={setPage}
              hasNext={query.isPlaceholderData ? undefined : query.data?.hasNext}
              resetKey={teamId.toString()}
              pageSize={PAGE_SIZE}
              testId="settings-agents-pager"
            />
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
