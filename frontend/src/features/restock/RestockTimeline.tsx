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

// `bare` — inside a section that is already a card, it draws no card of its own (never a card inside a card; owner, on the
// restock detail: *"riwayat jangan card di dalam card, lebur cardnya"*).
// THE ICON SITS AT THE MIDDLE OF ITS STEP (owner: *"riwayat iconnya kurang pas, lebih bagus di tengah"*,
// the-timeline-is-centred-and-lines-up) — Chakra draws it at the top. The connector is a column centring it, padded at its
// foot by the same gap the content leaves below itself, so the middle is the content's and not the gap's.
const CENTRED = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  pb: "var(--timeline-content-gap)",
} as const;

// Chakra zeroes the last step's gap as a bare `0`, which no `calc()` can add to a percentage — the last step's upper half
// came out invalid and collapsed. A length keeps the sum valid.
const LAST_GAP = { "& > :last-child": { "--timeline-content-gap": "0px" } } as const;

// THE LINE RUNS ICON TO ICON (owner: *"garis riwayatnya masih belum ngikut"*). Chakra's line spans a step top to bottom and
// is hidden on the last, which fits an icon at the TOP — under a centred one it stuck out above the first icon and stopped
// short of the last. So each step draws two halves meeting at its icon's centre ((height − gap) / 2 from its top): one up
// to the step before, one down to the step after. The first has no upper half, the last no lower one.
function StepLines({ first, last }: { first: boolean; last: boolean }) {
  return (
    <>
      {!first && (
        <Timeline.Separator
          css={{ display: "block", insetBlockStart: "0", insetBlockEnd: "calc(50% + var(--timeline-content-gap) / 2)" }}
        />
      )}
      {!last && (
        <Timeline.Separator
          css={{ display: "block", insetBlockStart: "calc(50% - var(--timeline-content-gap) / 2)", insetBlockEnd: "0" }}
        />
      )}
    </>
  );
}

export function RestockTimeline({ request, bare = false }: { request: RestockRequest; bare?: boolean }) {
  const { t } = useTranslation();
  const actors = useRestockActors(request.logs.map((log) => log.actorUserId));

  // The step that has NOT happened yet, while it still can — the honest end of the sequence rather than a dead stop.
  const awaitingKey =
    request.status === RestockRequestStatus.ONGOING
      ? "restock.timeline.awaitingSign"
      : request.status === RestockRequestStatus.ARRIVED
        ? "restock.timeline.awaitingCount"
        : "";

  const steps = (
        // `lg` so a 16px glyph fits its disc; `subtle` so each step is a quiet marker, not a heavy dot.
        <Timeline.Root size="lg" variant="subtle" css={LAST_GAP} data-testid={bare ? "restock-detail-timeline" : undefined}>
          {request.logs.map((log, i) => (
            <LogStep
              key={log.id > 0n ? log.id.toString() : `i${i}`}
              log={log}
              actor={actors.data?.get(log.actorUserId.toString())}
              first={i === 0}
              last={i === request.logs.length - 1 && !awaitingKey}
            />
          ))}

          {awaitingKey && (
            <Timeline.Item data-testid="restock-timeline-awaiting">
              <Timeline.Connector {...CENTRED}>
                <StepLines first={request.logs.length === 0} last />
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
  );

  if (bare) return steps;

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="restock-detail-timeline">
      <Card.Body>{steps}</Card.Body>
    </Card.Root>
  );
}

// ONE ROW: the person, a rule, then what happened — the status move as two badges, what changed or why, and when.
function LogStep({ log, actor, first, last }: { log: RestockLog; actor?: PublicUser; first: boolean; last: boolean }) {
  const { t } = useTranslation();
  const kind = kindOf(log);
  const look = lookOf(log);
  const fallback = log.actorUserId > 0n ? t("restock.table.userRef", { id: log.actorUserId.toString() }) : "";

  return (
    <Timeline.Item data-testid={`restock-timeline-${log.id}`} data-kind={kind}>
      <Timeline.Connector {...CENTRED}>
        <StepLines first={first} last={last} />
        <Timeline.Indicator colorPalette={look.palette} color={look.palette ? "colorPalette.fg" : "fg.muted"}>
          <Icon as={look.icon} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      {/* minW="0" down the chain, so a narrow phone wraps a step instead of pushing it past the screen's edge — inside a
          section the timeline has no card of its own to clip it (nothing-runs-past-a-phones-edge). */}
      <Timeline.Content flex="1" minW="0">
        <Flex align="center" gap="card" wrap="wrap" minW="0">
          {actor ? (
            // ONE WIDTH FOR EVERY STEP (owner: *"ukuran usernya lebih bagus kalau sama rata"*) — the rule beside it lines up
            // down the timeline. A phone gives the person the whole line, the step under it.
            <Box w={{ base: "full", sm: "40" }} flexShrink={0} minW="0" data-testid={`restock-timeline-${log.id}-by`}>
              <UserItem user={actor} size="xs" />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" w={{ base: "full", sm: "40" }} flexShrink={0} lineClamp={1}>
                {fallback}
              </Text>
            )
          )}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" hideBelow="sm" />}

          <Stack gap="1" minW="0" flex="1">
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {/* The move itself — FROM → TO for a status change; an edit keeps its status, so it shows that once. */}
              {kind === "status" ? (
                <HStack gap="1" wrap="wrap" data-testid={`restock-timeline-${log.id}-move`}>
                  <RestockStatusBadge status={log.fromStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <RestockStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                <RestockStatusBadge status={log.toStatus} />
              )}
            </HStack>
            {/* What changed (an edit) or why (a status change). A raise has no "why" — the row says it was raised. */}
            {/* The server's bare "edited" says nothing the row's title does not — it is not shown (an edit's row should
                name what changed; the-notes-are-one-per-writer). */}
            {kind !== "created" && log.description && log.description !== "edited" && (
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
