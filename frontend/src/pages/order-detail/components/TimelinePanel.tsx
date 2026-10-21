import { useTranslation } from "react-i18next";
import { Box, Card, Flex, Icon, Separator, Text, Timeline } from "@chakra-ui/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleCheck,
  Clock,
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

import type { Order, OrderEvent } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderEventKind, OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
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

// How each kind renders. A map rather than a switch so an UNKNOWN kind — an event written by a newer
// build than this screen — falls through to a readable default instead of crashing the tab.
//
// The palette is doing work, not decoration: the ENDINGS are coloured, each in its status's own hue, and
// the steps on the way there are not, so the state an order finished in is findable without reading a word.
const LOOK: Partial<Record<OrderEventKind, { icon: LucideIcon; palette?: string }>> = {
  [OrderEventKind.PENDING]: { icon: ShoppingCart },
  [OrderEventKind.PROCESSED]: { icon: CheckCircle2 },
  [OrderEventKind.PICKED]: { icon: PackageCheck },
  [OrderEventKind.SHIPPING]: { icon: Truck },
  [OrderEventKind.SHIPPED]: { icon: Navigation },
  [OrderEventKind.COMPLETED]: { icon: CircleCheck, palette: "green" },
  [OrderEventKind.PROBLEM]: { icon: AlertTriangle },
  [OrderEventKind.LOST]: { icon: PackageX, palette: "purple" },
  [OrderEventKind.RETURN]: { icon: Undo2 },
  [OrderEventKind.RETURN_COMPLETED]: { icon: PackageOpen, palette: "pink" },
  [OrderEventKind.CANCEL]: { icon: Ban, palette: "rose" },
};

/**
 * The i18n key per event kind.
 *
 * ⚠ EXPORTED because the order-detail PREVIEW and the seller's rail render the same events. Two screens
 * naming the same event differently is exactly what one shared map prevents. Prefer
 * `timelineTitleKey`, which also tells a placement from a hand-back.
 */
export const TIMELINE_TITLE: Partial<Record<OrderEventKind, string>> = {
  [OrderEventKind.PENDING]: "orders.timeline.placed",
  [OrderEventKind.PROCESSED]: "orders.timeline.confirmed",
  [OrderEventKind.PICKED]: "orders.timeline.picked",
  [OrderEventKind.SHIPPING]: "orders.timeline.shipping",
  [OrderEventKind.SHIPPED]: "orders.timeline.shipped",
  [OrderEventKind.COMPLETED]: "orders.timeline.completed",
  [OrderEventKind.PROBLEM]: "orders.timeline.problem",
  [OrderEventKind.LOST]: "orders.timeline.lost",
  [OrderEventKind.RETURN]: "orders.timeline.return",
  [OrderEventKind.RETURN_COMPLETED]: "orders.timeline.returnCompleted",
  [OrderEventKind.CANCEL]: "orders.timeline.cancelled",
};

/**
 * The i18n key for one event, given its place in the history.
 *
 * ⚠ A `pending` IS TWO DIFFERENT EVENTS: the order being placed — always the first row — or the warehouse
 * handing it back (goods on no rack, the platform cancelled), which carries a note saying why.
 */
export function timelineTitleKey(event: OrderEvent, index: number): string {
  if (event.kind === OrderEventKind.PENDING && index > 0) {
    return "orders.timeline.handedBack";
  }

  return TIMELINE_TITLE[event.kind] ?? "orders.timeline.unknown";
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
// ⚠ IT READS `order.events`, NOT the status. The status is one word about now; the events are the
// history, and only one of them can say a person's name.
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
          {order.events.map((event, i) => (
            <EventStep
              key={event.id > 0n ? event.id.toString() : `i${i}`}
              event={event}
              actor={actors?.get(event.actorUserId.toString())}
              fallback={actorFallback(event.actorUserId)}
              title={t(timelineTitleKey(event, i))}
              icon={event.kind === OrderEventKind.PENDING && i > 0 ? RotateCcw : (LOOK[event.kind]?.icon ?? Clock)}
              palette={LOOK[event.kind]?.palette}
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
// It degrades in the right direction: a step whose event records no actor starts at its title, because
// the flex row has nothing in its first slot rather than an empty box holding space — and the
// separator goes with it, since a divider dangling in front of a title reads as a missing avatar.
function EventStep({
  event,
  actor,
  fallback,
  title,
  icon,
  palette,
}: {
  event: OrderEvent;
  actor?: PublicUser;
  fallback: string;
  title: string;
  icon: LucideIcon;
  palette?: string;
}) {
  const testId = `order-timeline-${timelineKindSlug(event.kind)}`;

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
            // "nobody did this", a different and false claim. An actor of 0 has no fallback and
            // correctly shows neither: every event backfilled by 00011 is in that state, because the
            // orders table never recorded who did anything.
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
            <Timeline.Description>{formatUnixDateTime(event.atUnix)}</Timeline.Description>
            {/* WHY, when the move needed a reason — a hand-back to pending always says one. */}
            {event.note && (
              <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-note`}>
                {event.note}
              </Text>
            )}
          </Box>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}

// The testid segment per kind. Stable strings rather than the enum's number, so a selector reads
// `order-timeline-shipped` and survives the enum gaining a value.
/** Exported so the seller's timeline RAIL carries the same testids this tab's steps do. */
export function timelineKindSlug(kind: OrderEventKind): string {
  return SLUG[kind] ?? "unknown";
}

const SLUG: Partial<Record<OrderEventKind, string>> = {
  [OrderEventKind.PENDING]: "pending",
  [OrderEventKind.PROCESSED]: "processed",
  [OrderEventKind.PICKED]: "picked",
  [OrderEventKind.SHIPPING]: "shipping",
  [OrderEventKind.SHIPPED]: "shipped",
  [OrderEventKind.COMPLETED]: "completed",
  [OrderEventKind.PROBLEM]: "problem",
  [OrderEventKind.LOST]: "lost",
  [OrderEventKind.RETURN]: "return",
  [OrderEventKind.RETURN_COMPLETED]: "return_completed",
  [OrderEventKind.CANCEL]: "cancel",
};
