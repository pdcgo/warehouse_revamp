import { useTranslation } from "react-i18next";
import { Box, Card, Flex, Icon, Separator, Text, Timeline } from "@chakra-ui/react";
import { Ban, CheckCircle2, Clock, Hand, PackageCheck, ShoppingCart, Truck } from "lucide-react";
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
// The palette is doing work, not decoration: the two ENDINGS are coloured (green for shipped, red for
// cancelled) and the steps on the way there are not, so the state an order finished in is findable
// without reading a word.
const LOOK: Partial<Record<OrderEventKind, { icon: LucideIcon; palette?: string }>> = {
  [OrderEventKind.PLACED]: { icon: ShoppingCart },
  [OrderEventKind.CONFIRMED]: { icon: CheckCircle2 },
  [OrderEventKind.PICKING]: { icon: Hand },
  [OrderEventKind.PACKED]: { icon: PackageCheck },
  [OrderEventKind.SHIPPED]: { icon: Truck, palette: "green" },
  [OrderEventKind.CANCELLED]: { icon: Ban, palette: "red" },
};

const TITLE_KEY: Partial<Record<OrderEventKind, string>> = {
  [OrderEventKind.PLACED]: "orders.timeline.placed",
  [OrderEventKind.CONFIRMED]: "orders.timeline.confirmed",
  [OrderEventKind.PICKING]: "orders.timeline.picking",
  [OrderEventKind.PACKED]: "orders.timeline.packed",
  [OrderEventKind.SHIPPED]: "orders.timeline.shipped",
  [OrderEventKind.CANCELLED]: "orders.timeline.cancelled",
};

// WHAT IS STILL OWED, per status — the step that has not happened yet.
//
// Only for the states something is expected to happen FROM. SHIPPED and CANCELLED are endings: a
// waiting step under either would promise work nobody is going to do.
const AWAITING_KEY: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PLACED]: "orders.timeline.awaitingConfirm",
  [OrderStatus.CONFIRMED]: "orders.timeline.awaitingPick",
  [OrderStatus.PICKING]: "orders.timeline.awaitingPack",
  [OrderStatus.PACKED]: "orders.timeline.awaitingShip",
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
              title={t(TITLE_KEY[event.kind] ?? "orders.timeline.unknown")}
              icon={LOOK[event.kind]?.icon ?? Clock}
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
  const testId = `order-timeline-${kindSlug(event.kind)}`;

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
          </Box>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}

// The testid segment per kind. Stable strings rather than the enum's number, so a selector reads
// `order-timeline-shipped` and survives the enum gaining a value.
function kindSlug(kind: OrderEventKind): string {
  switch (kind) {
    case OrderEventKind.PLACED:
      return "placed";
    case OrderEventKind.CONFIRMED:
      return "confirmed";
    case OrderEventKind.PICKING:
      return "picking";
    case OrderEventKind.PACKED:
      return "packed";
    case OrderEventKind.SHIPPED:
      return "shipped";
    case OrderEventKind.CANCELLED:
      return "cancelled";
    default:
      return "unknown";
  }
}
