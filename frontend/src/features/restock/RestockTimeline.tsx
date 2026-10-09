import { useTranslation } from "react-i18next";
import { Box, Card, Flex, HStack, Icon, Separator, Stack, Text, Timeline } from "@chakra-ui/react";
import { ArrowRight, Ban, Clock, FilePlus2, PackageCheck, PackageOpen, PackageX, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { RestockLog, RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useRestockActors } from "./queries";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { UserItem } from "../../components/entity/UserItem";
import { formatUnixDateTime } from "../../lib/datetime";

// THE TRAIL — `request.logs`, oldest first (every-status-change-is-logged). One row per status change AND per edit: an
// edit is a row whose status did not change, and its description says what did — "Kopi 10 → 12, extra stock"
// (edits-are-in-the-same-trail). So one history answers both "when did it arrive, and who signed" and "who changed the
// count after the box was opened".
//
// Who did it is resolved by id at read time — never a snapshot — through the shared user lookup; an id that does not
// resolve names its number rather than claiming nobody did it.

type Kind = "created" | "edit" | "status";

function kindOf(log: RestockLog): Kind {
  if (log.fromStatus === RestockRequestStatus.UNSPECIFIED) return "created";
  if (log.fromStatus === log.toStatus) return "edit";

  return "status";
}

const STATUS_LOOK: Partial<Record<RestockRequestStatus, { icon: LucideIcon; titleKey: string; palette: string }>> = {
  [RestockRequestStatus.ARRIVED]: { icon: PackageOpen, titleKey: "restock.timeline.arrived", palette: "orange" },
  [RestockRequestStatus.ACCEPTED]: { icon: PackageCheck, titleKey: "restock.timeline.accepted", palette: "green" },
  [RestockRequestStatus.LOST]: { icon: PackageX, titleKey: "restock.timeline.lost", palette: "red" },
  [RestockRequestStatus.CANCELLED]: { icon: Ban, titleKey: "restock.timeline.cancelled", palette: "gray" },
};

function lookOf(log: RestockLog): { icon: LucideIcon; titleKey: string; palette?: string } {
  switch (kindOf(log)) {
    case "created":
      return { icon: FilePlus2, titleKey: "restock.timeline.created" };
    case "edit":
      return { icon: Pencil, titleKey: "restock.timeline.edited" };
    default:
      return STATUS_LOOK[log.toStatus] ?? { icon: Clock, titleKey: "restock.timeline.changed" };
  }
}

export function RestockTimeline({ request }: { request: RestockRequest }) {
  const { t } = useTranslation();
  const actors = useRestockActors(request.logs.map((log) => log.actorUserId));

  // The step that has NOT happened yet, while it still can — the honest end of the sequence rather than a dead stop.
  const awaitingKey =
    request.status === RestockRequestStatus.ONGOING
      ? "restock.timeline.awaitingSign"
      : request.status === RestockRequestStatus.ARRIVED
        ? "restock.timeline.awaitingCount"
        : "";

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="restock-detail-timeline">
      <Card.Body>
        {/* `lg` so a 16px glyph fits its disc; `subtle` so each step is a quiet marker, not a heavy dot. */}
        <Timeline.Root size="lg" variant="subtle">
          {request.logs.map((log, i) => (
            <LogStep
              key={log.id > 0n ? log.id.toString() : `i${i}`}
              log={log}
              actor={actors.data?.get(log.actorUserId.toString())}
            />
          ))}

          {awaitingKey && (
            <Timeline.Item data-testid="restock-timeline-awaiting">
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator color="fg.muted" opacity={0.6}>
                  <Icon as={Clock} boxSize="4" />
                </Timeline.Indicator>
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title color="fg.muted">{t(awaitingKey)}</Timeline.Title>
              </Timeline.Content>
            </Timeline.Item>
          )}
        </Timeline.Root>
      </Card.Body>
    </Card.Root>
  );
}

// ONE ROW: the person, a rule, then what happened — the status move as two badges, what changed or why, and when.
function LogStep({ log, actor }: { log: RestockLog; actor?: PublicUser }) {
  const { t } = useTranslation();
  const kind = kindOf(log);
  const look = lookOf(log);
  const fallback = log.actorUserId > 0n ? t("restock.table.userRef", { id: log.actorUserId.toString() }) : "";

  return (
    <Timeline.Item data-testid={`restock-timeline-${log.id}`} data-kind={kind}>
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator colorPalette={look.palette} color={look.palette ? "colorPalette.fg" : "fg.muted"}>
          <Icon as={look.icon} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      <Timeline.Content>
        <Flex align="center" gap="card" wrap="wrap">
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`restock-timeline-${log.id}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" flexShrink="0">
                {fallback}
              </Text>
            )
          )}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" />}

          <Stack gap="1" minW="0" flex="1">
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {/* The move itself — FROM → TO for a status change; an edit keeps its status, so it shows that once. */}
              {kind === "status" ? (
                <HStack gap="1" data-testid={`restock-timeline-${log.id}-move`}>
                  <RestockStatusBadge status={log.fromStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <RestockStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                <RestockStatusBadge status={log.toStatus} />
              )}
            </HStack>
            {/* What changed (an edit) or why (a status change). A raise has no "why" — the row says it was raised. */}
            {kind !== "created" && log.description && (
              <Text
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                data-testid={`restock-timeline-${log.id}-description`}
              >
                {log.description}
              </Text>
            )}
            <Timeline.Description>
              {log.atUnix > 0n ? formatUnixDateTime(log.atUnix) : t("restock.timeline.noDate")}
            </Timeline.Description>
          </Stack>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}
