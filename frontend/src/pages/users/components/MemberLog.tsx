import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import {
  type TeamMemberLogEntry,
  TeamMemberLogAction,
} from "../../../gen/warehouse/user/v1/user_pb";
import type { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { useActors, useTeamMemberLog } from "../../../features/users/queries";
import { Pagination } from "../../../components/chrome/Pagination";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { formatUnixDateTime } from "../../../lib/datetime";
import { roleLabel } from "../../../lib/roles";

const PAGE_SIZE = 10;

// MemberLog — who joined this team, who left, and whose role changed, by whom and when
// (every-role-change-is-logged). Newest first.
//
// It is the Users page's own tab, beside the members (the-history-is-a-tab-beside-the-members) — so it
// draws no heading: the tab is its title.
//
// A row is a SENTENCE, not a grid: "ani01 changed budi from Customer Service to Admin". The four facts
// only mean something together, and a table of them makes the reader assemble the sentence.
export function MemberLog({ teamId, teamType }: { teamId: bigint; teamType?: TeamType }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const query = useTeamMemberLog({ teamId, page, pageSize: PAGE_SIZE });
  const entries = query.data?.entries ?? [];
  const actors = useActors(entries.flatMap((e) => [e.actorUserId, e.userId]));

  function who(id: bigint, agent?: string): string {
    if (id === 0n) return agent || t("users.log.system");
    const person = actors.data?.get(id.toString());

    return person ? person.username : t("users.log.userRef", { id: id.toString() });
  }

  function sentence(e: TeamMemberLogEntry): string {
    const vars = {
      actor: who(e.actorUserId, e.actorAgent),
      user: who(e.userId),
      from: roleLabel(e.roleBefore, teamType),
      to: roleLabel(e.roleAfter, teamType),
    };

    switch (e.action) {
      case TeamMemberLogAction.ADD:
        return t("users.log.added", vars);
      case TeamMemberLogAction.CHANGE_ROLE:
        return t("users.log.changed", vars);
      case TeamMemberLogAction.REMOVE:
        return t("users.log.removed", vars);
      default:
        return "";
    }
  }

  return (
    <Stack gap="card" data-testid="member-log">
      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : query.isError ? (
        <Text color="error.fg">{t("users.log.failed")}</Text>
      ) : entries.length === 0 ? (
        <Text color="fg.muted" data-testid="member-log-empty">
          {t("users.log.empty")}
        </Text>
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          <Stack gap="2">
            {entries.map((e) => (
              <HStack key={e.id.toString()} gap="card" align="baseline" data-testid={`member-log-${e.id}`}>
                <Text textStyle="xs" color="fg.muted" flexShrink={0} minW="9rem">
                  {formatUnixDateTime(e.createdAtUnix)}
                </Text>
                <Text textStyle="sm">{sentence(e)}</Text>
                {e.isOverride && (
                  <Badge colorPalette="warning" size="sm">
                    {t("users.log.override")}
                  </Badge>
                )}
              </HStack>
            ))}

            <Pagination
              count={query.data?.totalItems ?? 0}
              pageSize={PAGE_SIZE}
              page={page}
              onPageChange={setPage}
            />
          </Stack>
        </RefreshOverlay>
      )}
    </Stack>
  );
}
