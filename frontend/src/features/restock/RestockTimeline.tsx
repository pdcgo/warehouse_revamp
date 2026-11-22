import { useTranslation } from "react-i18next";
import { create } from "@bufbuild/protobuf";
import { Box, Card, Flex, HStack, Icon, Separator, Stack, Text, Timeline } from "@chakra-ui/react";
import { ArrowRight, Ban, BadgeCheck, ClipboardPen, Clock, FilePlus2, ListChecks, PackageCheck, PackageOpen, PackageX, Pencil, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { RestockLog, RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockLogKind, RestockLogSchema, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { ReceivedCountCorrection } from "../../gen/warehouse/inventory/v1/received_count_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useRestockActors } from "./queries";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { UserItem } from "../../components/entity/UserItem";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { trailOf } from "../receivedCount/corrections";
import { RestockEditChanges, type TrailNames, useTrailNames } from "./RestockEditChanges";
import { SettlementStep } from "../restockResolution/SettlementStep";

// THE TRAIL — `request.logs`, oldest first (every-status-change-is-logged). One row per status change AND per edit: an
// edit is a row whose status did not change, and under it what did — "Kopi 10 → 12, extra stock", each field the server
// kept before and after (edits-are-in-the-same-trail, RestockEditChanges). So one history answers both "when did it
// arrive, and who signed" and "who changed the count after the box was opened". An edit written before those were kept
// has none, and reads as it always did: who and when.
//
// `purchase` — the selling team's page, which reads the purchase: an edit's price, totals, supplier, store, account,
// Order ID and shipping. Off on the warehouse's (the-warehouse-reads-the-box-not-the-purchase). `teamId` is the reader's,
// for the names the purchase's ids need.
//
// Who did it is resolved by id at read time — never a snapshot — through the shared user lookup; an id that does not
// resolve names its number rather than claiming nobody did it.
//
// KOREKSI JUMLAH TERIMA's rows sit in the same trail, by time (`request.count_corrections`, one per corrected line): their
// own kind, never a status row, so a correction is never read as the selling team's edit
// (the-received-count-prototype-is-accepted).
//
// THE SETTLEMENT'S ROWS (backlog #101 — the owner's 🔄 on a-restock-problem-is-settled-by-resolution-rows): a resolution
// recorded, *Tandai Selesai*, a reopen by an inbound parcel's short or broken Terima — REAL rows of the same trail, each
// written when it happened and never rewritten (so settled → reopened → settled reads all three). They keep the status as
// an edit does; the row's `kind` tells them from one (SettlementStep draws what each names).

type Kind = "created" | "edit" | "status" | "resolution" | "settled" | "reopened";

function kindOf(log: RestockLog): Kind {
  if (log.kind === RestockLogKind.RESOLUTION) return "resolution";
  if (log.kind === RestockLogKind.SETTLED) return "settled";
  if (log.kind === RestockLogKind.REOPENED) return "reopened";
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
    case "resolution":
      return { icon: ListChecks, titleKey: "restockResolution.trail.recordedTitle", palette: "blue" };
    case "settled":
      return { icon: BadgeCheck, titleKey: "restockResolution.trail.settled", palette: "green" };
    case "reopened":
      return { icon: RotateCcw, titleKey: "restockResolution.trail.reopened", palette: "orange" };
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

export function RestockTimeline({
  request,
  bare = false,
  teamId,
  purchase = false,
}: {
  request: RestockRequest;
  bare?: boolean;
  teamId?: bigint;
  purchase?: boolean;
}) {
  const { t } = useTranslation();
  const names = useTrailNames(request.logs, teamId, purchase);
  const actors = useRestockActors([
    ...request.logs.map((log) => log.actorUserId),
    ...request.countCorrections.map((c) => c.actorUserId),
  ]);
  const trail = trailOf(request.logs, request.countCorrections);
  const nameOf = (c: ReceivedCountCorrection) => request.items.find((item) => item.id === c.itemId)?.name ?? "";

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
          {trail.map((step, i) =>
            step.kind === "log" ? (
              <LogStep
                key={step.log.id > 0n ? step.log.id.toString() : `i${i}`}
                log={step.log}
                actor={actors.data?.get(step.log.actorUserId.toString())}
                first={i === 0}
                last={i === trail.length - 1 && !awaitingKey}
                names={names}
                purchase={purchase}
                request={request}
                teamId={teamId}
              />
            ) : (
              <LogStep
                key={`c${step.correction.id}`}
                log={correctionLog(step.correction)}
                actor={actors.data?.get(step.correction.actorUserId.toString())}
                first={i === 0}
                last={i === trail.length - 1 && !awaitingKey}
                correction={step.correction}
                productName={nameOf(step.correction)}
              />
            ),
          )}

          {awaitingKey && (
            <Timeline.Item data-testid="restock-timeline-awaiting">
              <Timeline.Connector {...CENTRED}>
                <StepLines first={trail.length === 0} last />
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

// A correction's row drawn by the trail's own step: its person, Root stamp and time — on an accepted restock.
function correctionLog(c: ReceivedCountCorrection): RestockLog {
  return create(RestockLogSchema, {
    id: c.id,
    fromStatus: RestockRequestStatus.ACCEPTED,
    toStatus: RestockRequestStatus.ACCEPTED,
    actorUserId: c.actorUserId,
    atUnix: c.atUnix,
    isOverride: c.isOverride,
  });
}

// ONE ROW: the person, a rule, then what happened — the status move as two badges, what changed or why, and when.
function LogStep({
  log,
  actor,
  first,
  last,
  correction,
  productName = "",
  names,
  purchase = false,
  request,
  teamId,
}: {
  log: RestockLog;
  actor?: PublicUser;
  first: boolean;
  last: boolean;
  /** The trail's looked-up names, for what an edit changed. */
  names?: TrailNames;
  purchase?: boolean;
  /** The received-count correction this row stands for — its own kind, never a status row. */
  correction?: ReceivedCountCorrection;
  productName?: string;
  /** The restock — a settlement row names its resolution, read from the restock's `resolutions`. */
  request?: RestockRequest;
  teamId?: bigint;
}) {
  const { t } = useTranslation();
  const kind = correction ? "correction" : kindOf(log);
  const look = correction ? { icon: ClipboardPen, titleKey: "", palette: "orange" } : lookOf(log);
  const fallback = log.actorUserId > 0n ? t("restock.table.userRef", { id: log.actorUserId.toString() }) : "";
  // A correction's row id is its own table's — kept apart from the trail's ids.
  const testId = correction ? `restock-timeline-c${correction.id}` : `restock-timeline-${log.id}`;
  const settlement = kind === "resolution" || kind === "settled" || kind === "reopened";

  return (
    <Timeline.Item data-testid={testId} data-kind={kind}>
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
            <Box w={{ base: "full", sm: "40" }} flexShrink={0} minW="0" data-testid={`${testId}-by`}>
              <UserItem user={actor} size="xs" />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" w={{ base: "full", sm: "40" }} flexShrink={0} lineClamp={1}>
                {fallback}
              </Text>
            )
          )}
          {/* A step Root or the System Administrator took from outside the team: the shared "by Root team" badge right
              after the person (an-override-shows-a-platform-badge). */}
          {(actor || fallback) && log.isOverride && <RootTeamBadge />}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" hideBelow="sm" />}

          <Stack gap="1" minW="0" flex="1">
            {correction ? (
              <CorrectionStep correction={correction} productName={productName} testId={testId} />
            ) : (
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {/* The move itself — FROM → TO for a status change; an edit keeps its status, so it shows that once; a
                  settlement row is no move at all. */}
              {settlement ? null : kind === "status" ? (
                <HStack gap="1" wrap="wrap" data-testid={`${testId}-move`}>
                  <RestockStatusBadge status={log.fromStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <RestockStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                <RestockStatusBadge status={log.toStatus} />
              )}
            </HStack>
            )}
            {/* What changed (an edit) or why (a status change). A raise has no "why" — the row says it was raised. */}
            {/* The server's bare "edited" says nothing the row's title does not — it is not shown: an edit's row names what
                changed, field by field, under it (the-notes-are-one-per-writer, edits-are-in-the-same-trail). */}
            {settlement && request && <SettlementStep log={log} request={request} teamId={teamId} testId={testId} />}
            {!correction && !settlement && kind !== "created" && log.description && log.description !== "edited" && (
              <Text
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                data-testid={`${testId}-description`}
              >
                {log.description}
              </Text>
            )}
            {!correction && kind === "edit" && names && log.changes.length > 0 && (
              <RestockEditChanges changes={log.changes} names={names} purchase={purchase} testId={testId} />
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

// A RECEIVED-COUNT CORRECTION'S ROW (a-wrong-stock-in-is-a-received-count-correction): *Jumlah terima dikoreksi · 20 →
// 18*, the product and what it moved — *2 Kurang (koreksi)* out of the batch, or units into it — and, when the read
// carries it (the OWNING team only — a-warehouse-sees-no-seller-money), what that is worth at the batch price
// (a-stock-in-correction-keeps-the-batch-price); then the reason. Who did it is the row's person, with the Root badge
// when it was Root.
export function CorrectionStep({
  correction,
  productName,
  testId,
}: {
  correction: ReceivedCountCorrection;
  productName: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const out = correction.unitsOut;
  const value = correction.total;

  return (
    <Stack gap="0.5" minW="0" data-testid={`${testId}-correction`}>
      <Timeline.Title data-testid={`${testId}-correction-title`}>
        {t("receivedCount.history.title", { from: correction.fromCount.toString(), to: correction.toCount.toString() })}
      </Timeline.Title>
      <Text fontSize="sm" data-testid={`${testId}-correction-what`}>
        {productName}
        {" · "}
        {out > 0n
          ? t("receivedCount.history.out", { count: Number(out) })
          : t("receivedCount.history.in", { count: Number(-out) })}
        {value !== undefined && (
          <Text as="span" color="fg.muted" data-testid={`${testId}-correction-value`}>
            {" · "}
            {out > 0n
              ? t("receivedCount.borne", { amount: formatRupiahNumber(value) })
              : t("receivedCount.lifted", { amount: formatRupiahNumber(-value) })}
          </Text>
        )}
      </Text>
      <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap" wordBreak="break-word" data-testid={`${testId}-correction-reason`}>
        “{correction.reason}”
      </Text>
    </Stack>
  );
}
