import { useTranslation } from "react-i18next";
import { Box, Card, Flex, Icon, Separator, Text, Timeline } from "@chakra-ui/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleCheck,
  Clock,
  MessageSquareText,
  PackageCheck,
  PackageOpen,
  PackageX,
  Navigation,
  RotateCcw,
  ShoppingCart,
  Truck,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Order, OrderTimelineLog } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus, OrderTimelineFrom } from "../../../gen/warehouse/selling/v1/order_pb";
import type { PublicUser } from "../../../gen/warehouse/user/v1/user_pb";
import { UserItem } from "../../../components/entity/UserItem";
import { formatUnixDateTime } from "../../../lib/datetime";

export interface TimelinePanelProps {
  order: Order;
  /**
   * The people behind the events' actor ids, keyed by id as a string. A miss is an honest absence —
   * either the event records no actor (0) or user_service could not resolve it — and the step then
   * falls back to naming the number rather than claiming nobody did it.
   */
  actors?: Map<string, PublicUser>;
  /** Names an unresolved actor id ("User #7"). Empty string for an id of 0. */
  actorFallback: (userId: bigint) => string;
}

// How each status renders. A map rather than a switch so an UNKNOWN status — a row written by a newer
// build than this screen — falls through to a readable default instead of crashing the tab.
//
// The palette is doing work, not decoration: the ENDINGS are coloured, each in its status's own hue, and
// the steps on the way there are not, so the state an order finished in is findable without reading a word.
const LOOK: Partial<Record<OrderStatus, { icon: LucideIcon; palette?: string }>> = {
  [OrderStatus.PENDING]: { icon: ShoppingCart },
  [OrderStatus.PROCESSED]: { icon: CheckCircle2 },
  [OrderStatus.PICKED]: { icon: PackageCheck },
  [OrderStatus.SHIPPING]: { icon: Truck },
  [OrderStatus.SHIPPED]: { icon: Navigation },
  [OrderStatus.COMPLETED]: { icon: CircleCheck, palette: "green" },
  [OrderStatus.PROBLEM]: { icon: AlertTriangle },
  [OrderStatus.LOST]: { icon: PackageX, palette: "purple" },
  [OrderStatus.RETURN]: { icon: Undo2 },
  [OrderStatus.RETURN_COMPLETED]: { icon: PackageOpen, palette: "pink" },
  [OrderStatus.CANCEL]: { icon: Ban, palette: "rose" },
};

/** A row that is a NOTE only, no move (order-timeline-logs-replaces-order-events): no goods on Rak A. */
function isNote(log: OrderTimelineLog): boolean {
  return log.status === OrderStatus.UNSPECIFIED && log.note !== "";
}

/** The icon for one row — a hand-back reads as a turn back, a note as a note. */
export function timelineIcon(log: OrderTimelineLog, index: number): LucideIcon {
  if (isNote(log)) return MessageSquareText;
  if (log.status === OrderStatus.PENDING && index > 0) return RotateCcw;

  return LOOK[log.status]?.icon ?? Clock;
}

/** The i18n key of the side that wrote a row, or "" when it is not recorded. */
export function timelineFromKey(from: OrderTimelineFrom): string {
  if (from === OrderTimelineFrom.WAREHOUSE) return "orders.timeline.from.warehouse";
  if (from === OrderTimelineFrom.SELLING) return "orders.timeline.from.selling";

  return "";
}

/**
 * The i18n key per event kind.
 *
 * ⚠ EXPORTED because the order-detail PREVIEW and the seller's rail render the same events. Two screens
 * naming the same event differently is exactly what one shared map prevents. Prefer
 * `timelineTitleKey`, which also tells a placement from a hand-back.
 */
export const TIMELINE_TITLE: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING]: "orders.timeline.placed",
  [OrderStatus.PROCESSED]: "orders.timeline.confirmed",
  [OrderStatus.PICKED]: "orders.timeline.picked",
  [OrderStatus.SHIPPING]: "orders.timeline.shipping",
  [OrderStatus.SHIPPED]: "orders.timeline.shipped",
  [OrderStatus.COMPLETED]: "orders.timeline.completed",
  [OrderStatus.PROBLEM]: "orders.timeline.problem",
  [OrderStatus.LOST]: "orders.timeline.lost",
  [OrderStatus.RETURN]: "orders.timeline.return",
  [OrderStatus.RETURN_COMPLETED]: "orders.timeline.returnCompleted",
  [OrderStatus.CANCEL]: "orders.timeline.cancelled",
};

/**
 * The i18n key for one row, given its place in the timeline.
 *
 * ⚠ A `pending` IS TWO DIFFERENT ROWS: the order being placed — always the first row — or the warehouse
 * handing it back (goods on no rack, the platform cancelled), which carries a note saying why. And a row with
 * no status at all is a note written while working the order.
 */
export function timelineTitleKey(log: OrderTimelineLog, index: number): string {
  if (isNote(log)) {
    return "orders.timeline.note";
  }

  if (log.status === OrderStatus.PENDING && index > 0) {
    return "orders.timeline.handedBack";
  }

  return TIMELINE_TITLE[log.status] ?? "orders.timeline.unknown";
}

// WHAT IS STILL OWED, per status — the step that has not happened yet.
//
// Only for the states something is expected to happen FROM. The endings — completed, lost,
// return_completed and cancel — have none: a waiting step under one would promise work nobody is going
// to do. Problem has none either: what happens next is customer service's call, not a step in a line.
const AWAITING_KEY: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING]: "orders.timeline.awaitingConfirm",
  [OrderStatus.PROCESSED]: "orders.timeline.awaitingPick",
  [OrderStatus.PICKED]: "orders.timeline.awaitingShip",
  [OrderStatus.SHIPPING]: "orders.timeline.awaitingShipped",
  [OrderStatus.SHIPPED]: "orders.timeline.awaitingDelivery",
  [OrderStatus.RETURN]: "orders.timeline.awaitingReturn",
};

// TIMELINE — WHO DID WHAT, AND WHEN.
//
// An order is handled by TWO TEAMS: the selling side takes it and confirms it, the warehouse picks,
// packs and ships it. This tab is the only place the page says so — everything else on the screen
// describes the order's CURRENT state, which cannot answer "when was this confirmed, and who has been
// sitting on it since".
//
// Why a timeline rather than a row of stamped fields in the Info grid: these are EVENTS. A grid says
// they are all equally true right now; a sequence says one followed another, which is what somebody
// reconstructing a late delivery actually reads. It is also the shape that has somewhere honest to put
// what has NOT happened yet.
//
// ⚠ IT READS `order.timelineLogs`, NOT the status (order-timeline-logs-replaces-order-events). The status is one
// word about now; the timeline is the history, and only it can say a person's name and which side acted.
export function TimelinePanel({ order, actors, actorFallback }: TimelinePanelProps) {
  const { t } = useTranslation();

  const awaitingKey = AWAITING_KEY[order.status];

  return (
    <Card.Root data-testid="order-detail-timeline">
      <Card.Body>
        {/* THE INDICATOR HAS TO FIT ITS ICON. `size` sets `--timeline-indicator-size`: sm is 16px, and
            a 16px glyph inside it renders as a dark blob rather than an icon. `variant="subtle"` tints
            the disc instead of filling it solid, so a step reads as a quiet marker and the person
            beside it stays the content. Same settings as the restock timeline, for the same reasons —
            the two screens are the same object and must not look like different products. */}
        <Timeline.Root size="lg" variant="subtle">
          {order.timelineLogs.map((log, i) => (
            <LogStep
              key={log.id > 0n ? log.id.toString() : `i${i}`}
              log={log}
              actor={actors?.get(log.actorId.toString())}
              fallback={actorFallback(log.actorId)}
              title={t(timelineTitleKey(log, i))}
              icon={timelineIcon(log, i)}
              palette={LOOK[log.status]?.palette}
            />
          ))}

          {/* The step nobody has taken yet, and only while it still can be taken. An order sitting in
              CONFIRMED is waiting on the warehouse, and saying so is the honest end of the sequence —
              stopping dead after the last thing that happened reads as a record that was left
              unfinished. */}
          {awaitingKey && (
            <Timeline.Item data-testid="order-timeline-awaiting">
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

// ONE STEP: the person, a rule, then what they did and when.
//
// THE PERSON LEADS, read left to right: "Rina │ Order confirmed / Monday 14:20". Stacked, the face and
// its caption cost three lines per step and a five-step timeline scrolls; side by side it is one line
// each and the column of avatars becomes the thing you scan down.
//
// It degrades in the right direction: a step whose row records no actor starts at its title, because
// the flex row has nothing in its first slot rather than an empty box holding space — and the
// separator goes with it, since a divider dangling in front of a title reads as a missing avatar.
function LogStep({
  log,
  actor,
  fallback,
  title,
  icon,
  palette,
}: {
  log: OrderTimelineLog;
  actor?: PublicUser;
  fallback: string;
  title: string;
  icon: LucideIcon;
  palette?: string;
}) {
  const { t } = useTranslation();
  const testId = `order-timeline-${timelineSlug(log)}`;
  const fromKey = timelineFromKey(log.from);

  return (
    <Timeline.Item data-testid={testId}>
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator
          colorPalette={palette}
          color={palette ? "colorPalette.fg" : "fg.muted"}
        >
          <Icon as={icon} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      <Timeline.Content>
        <Flex align="center" gap="card" wrap="wrap">
          {/* The SHARED UserItem — avatar, name, @username — so a face here reads exactly as it does in
              the user list and on the restock timeline. `w="auto"` / `maxW` because UserItem fills its
              container by default, which in a flex row would push the caption off the end. */}
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`${testId}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            // An id that did not resolve still names its number — showing nothing would read as
            // "nobody did this", a different and false claim. An actor of 0 is "not recorded", has no
            // fallback and correctly shows neither.
            fallback && (
              <Text fontSize="sm" fontWeight="medium" flexShrink="0">
                {fallback}
              </Text>
            )
          )}

          {/* `height="auto"` + `alignSelf="stretch"` because a vertical Separator has no intrinsic
              height — left to itself in a flex row it collapses to nothing and never appears. */}
          {(actor || fallback) && (
            <Separator orientation="vertical" height="auto" alignSelf="stretch" />
          )}

          <Box>
            <Timeline.Title>{title}</Timeline.Title>
            {/* Date AND TIME. Several orders are confirmed in one morning and picked the same
                afternoon — the day alone cannot put those in order, and "how long did it sit between
                confirmed and picked" is the question this tab is opened to answer. */}
            {/* WHICH SIDE, then when. The two teams act on one order, and "was this the warehouse or us?" is
                half of what this tab is opened to answer. */}
            <Timeline.Description data-testid={`${testId}-when`}>
              {[fromKey ? t(fromKey) : "", formatUnixDateTime(log.createdAtUnix)].filter(Boolean).join(" · ")}
            </Timeline.Description>
            {/* WHY, when the move needed a reason — a hand-back to pending always says one — or the note itself. */}
            {log.note && (
              <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-note`}>
                {log.note}
              </Text>
            )}
          </Box>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}

// The testid segment per row. Stable strings rather than the enum's number, so a selector reads
// `order-timeline-shipped` and survives the enum gaining a value. A note-only row is `note`.
/** Exported so the seller's timeline RAIL carries the same testids this tab's steps do. */
export function timelineSlug(log: OrderTimelineLog): string {
  if (isNote(log)) return "note";

  return SLUG[log.status] ?? "unknown";
}

const SLUG: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING]: "pending",
  [OrderStatus.PROCESSED]: "processed",
  [OrderStatus.PICKED]: "picked",
  [OrderStatus.SHIPPING]: "shipping",
  [OrderStatus.SHIPPED]: "shipped",
  [OrderStatus.COMPLETED]: "completed",
  [OrderStatus.PROBLEM]: "problem",
  [OrderStatus.LOST]: "lost",
  [OrderStatus.RETURN]: "return",
  [OrderStatus.RETURN_COMPLETED]: "return_completed",
  [OrderStatus.CANCEL]: "cancel",
};
