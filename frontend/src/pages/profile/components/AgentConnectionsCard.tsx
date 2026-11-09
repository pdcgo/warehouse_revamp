import { useState } from "react";
import { Alert, Box, Card, Heading, Separator, Stack, Text } from "@chakra-ui/react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../../api/clients";
import { CopyText } from "../../../components/chrome/CopyText";
import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { AgentConnectionRow } from "../../../features/agents/AgentConnectionRow";
import { mcpUrl } from "../../../features/agents/connect";
import { useMyAgentConnections, useRevokeAgentConnection } from "../../../features/agents/queries";
import { useTeamsByIds } from "../../../features/teams/queries";

const PAGE_SIZE = 10;

// MY AI AGENTS on /profile (an-agent-gets-its-own-team-credential) — every agent this person connected, the team each
// reads ("Every team" for Root's — a-roots-agent-reads-every-team), and a Revoke for each that signs them out of nothing
// else. Under it, how to connect one: the URL to give ChatGPT or Claude as a custom connector (our-server-hosts-the-mcp).
export function AgentConnectionsCard() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const query = useMyAgentConnections({ page, pageSize: PAGE_SIZE });
  const revoke = useRevokeAgentConnection();

  const connections = query.data?.connections ?? [];
  // Named the way every screen names a team it holds only the id of — one TeamByIds for the page, never one per row.
  const teams = useTeamsByIds({ ids: connections.map((c) => c.teamId) });

  function teamName(teamId: bigint): string {
    if (teamId === 0n) return t("agents.connect.everyTeam");

    return teams.data?.[teamId.toString()]?.name ?? t("agents.row.teamNumber", { id: teamId.toString() });
  }

  return (
    <Card.Root data-testid="profile-agents">
      <Card.Body>
        <Stack gap="card">
          <Stack gap="1">
            <Heading size="sm">{t("agents.title")}</Heading>
            <Text color="fg.muted" fontSize="sm">
              {t("agents.profile.hint")}
            </Text>
          </Stack>

          {query.isPending ? (
            <ListSkeleton rows={2} />
          ) : query.isError ? (
            <Alert.Root status="error" data-testid="profile-agents-error">
              <Alert.Indicator />
              <Alert.Title>{rpcError(query.error)}</Alert.Title>
            </Alert.Root>
          ) : connections.length === 0 ? (
            <EmptyHint
              size="sm"
              icon={Bot}
              title={t("agents.profile.emptyTitle")}
              description={t("agents.profile.emptyHint")}
              testId="profile-agents-empty"
            />
          ) : (
            <RefreshOverlay busy={query.isFetching && !query.isPending}>
              <Stack gap="0" separator={<Separator />}>
                {connections.map((connection) => (
                  <AgentConnectionRow
                    key={connection.id.toString()}
                    connection={connection}
                    context={teamName(connection.teamId)}
                    revoke={async () => {
                      await revoke.mutateAsync(connection.id);
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
              resetKey="mine"
              pageSize={PAGE_SIZE}
              testId="profile-agents-pager"
            />
          )}

          <Separator />

          <Stack gap="2" data-testid="profile-agents-connect">
            <Text fontSize="sm" fontWeight="bold">
              {t("agents.profile.howTitle")}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {t("agents.profile.howHint")}
            </Text>
            <Box px="3" py="2" rounded="l2" bg="bg.muted" minW="0" overflowX="auto">
              <CopyText value={mcpUrl()} mono fontSize="sm" testId="profile-agents-mcp-url" />
            </Box>
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
