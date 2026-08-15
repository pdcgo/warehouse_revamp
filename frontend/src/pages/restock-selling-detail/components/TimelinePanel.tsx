import { useTranslation } from "react-i18next";
import { Box, Card, Flex, Icon, Separator, Text, Timeline } from "@chakra-ui/react";
import { Ban, Banknote, Clock, FilePlus2, PackageCheck, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  RestockRequest,
  RestockRequestEvent,
} from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockRequestEventKind,
  RestockRequestStatus,
} from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import type { PublicUser } from "../../../gen/warehouse/user/v1/user_pb";
import { UserItem } from "../../../components/entity/UserItem";
import { formatUnixDateTime } from "../../../lib/datetime";

export interface TimelinePanelProps {
  request: RestockRequest;
  /**
   * The people behind the events' actor ids, keyed by id as a string. A miss is an honest absence —
   * either the event records no actor (0) or user_service could not resolve it — and the step then
   * falls back to naming the number rather than claiming nobody did it.
   */
  actors?: Map<string, PublicUser>;
  /** Names an unresolved actor id ("User #7"). Empty string for an id of 0. */
  actorFallback: (userId: bigint) => string;
}

// How each kind of event renders. A map rather than a switch so an UNKNOWN kind — an event written by
// a newer build than this screen — falls through to a readable default instead of crashing the tab.
const LOOK: Partial<Record<RestockRequestEventKind, { icon: LucideIcon; palette?: string }>> = {
  [RestockRequestEventKind.CREATED]: { icon: FilePlus2 },
  [RestockRequestEventKind.EDITED]: { icon: Pencil },
  [RestockRequestEventKind.ACCEPTED]: { icon: PackageCheck, palette: "green" },
  [RestockRequestEventKind.CANCELLED]: { icon: Ban, palette: "red" },
  // Money left the warehouse's hands, and it reads as money — amber rather than the acceptance's
  // green, so the two steps of one arrival are told apart at a glance instead of by their captions.
  [RestockRequestEventKind.COD_FEE]: { icon: Banknote, palette: "orange" },
};

const TITLE_KEY: Partial<Record<RestockRequestEventKind, string>> = {
  [RestockRequestEventKind.CREATED]: "restock.timeline.created",
  [RestockRequestEventKind.EDITED]: "restock.timeline.edited",
  [RestockRequestEventKind.ACCEPTED]: "restock.timeline.accepted",
  [RestockRequestEventKind.CANCELLED]: "restock.timeline.cancelled",
  [RestockRequestEventKind.COD_FEE]: "restock.timeline.codFee",
};

// TIMELINE — WHO DID WHAT, AND WHEN.
//
// A restock is handled by TWO TEAMS and at least TWO PEOPLE, and this tab is the only place the page
// says so. It exists because the record already carried the answer and the screen threw it away: the
// restock LIST showed created-by, accepted-by and accepted-at, while the page you reached by clicking
// that row showed a single "Created" date and no people at all. Drilling in lost information.
//
// Why a timeline rather than three more fields in the Info grid: these are EVENTS, not terms of the
// purchase. A grid says they are all equally true right now; a sequence says one followed another,
// which is what a buyer reconstructing "when did this land, and who counted it" actually reads. It is
// also the shape that has somewhere honest to put what has NOT happened yet — a pending request ends
// with a waiting step rather than with silence.
//
// ⚠ IT READS `request.events`, NOT THE COLUMNS. That is the substance of the 00019 change: the steps
// used to be assembled from three column pairs, which could show only ONE of each — and an EDIT has no
// column pair at all, because a pending restock is edited repeatedly and `updated_by` would have
// remembered just the last. One append-only table, one order, and a new kind of event costs a row
// rather than another branch here.
//
// The columns are not gone and are not read here: the LIST filters and sorts on them, which a child
// table cannot do cheaply. They answer "what is the current state"; the events answer "what happened".
export function TimelinePanel({ request, actors, actorFallback }: TimelinePanelProps) {
  const { t } = useTranslation();

  const events = request.events;

  // The step that has NOT happened yet, and only while it still can. A pending restock is waiting on
  // the warehouse, and saying so is the honest end of the sequence — the alternative stops dead after
  // the last thing that happened and reads as though the record were incomplete.
  const awaiting = request.status === RestockRequestStatus.PENDING;

  return (
    <Card.Root data-testid="restock-detail-timeline">
      <Card.Body>
        {/* THE INDICATOR HAS TO FIT ITS ICON, which is the whole reason for both of these.
            `size` sets `--timeline-indicator-size`: sm is 16px, and a 12px glyph inside a 16px disc
            leaves 2px of padding — it renders as a dark blob you cannot read, not as an icon. lg is
            24px, which a 16px glyph sits in comfortably.
            `variant="subtle"` tints the disc instead of filling it solid: solid (the default) paints
            `colorPalette.solid` and drops a contrast-coloured glyph on it, so every step became a
            heavy dot competing with the avatar beside it. Subtle reads as a quiet marker, which is
            what a step in a timeline is — the person and the caption are the content. */}
        <Timeline.Root size="lg" variant="subtle">
          {/* An event with no history at all cannot happen — every restock gets a CREATED event, and
              00019 backfilled the ones that predate the table — so there is deliberately no empty
              state here. If one ever appears, it means the events did not load, and a blank card is
              the correct thing to notice rather than a reassuring "nothing has happened yet". */}
          {events.map((event, i) => (
            <EventStep
              key={event.id > 0n ? event.id.toString() : `i${i}`}
              event={event}
              actor={actors?.get(event.actorUserId.toString())}
              fallback={actorFallback(event.actorUserId)}
              title={t(TITLE_KEY[event.kind] ?? "restock.timeline.unknown")}
              icon={LOOK[event.kind]?.icon ?? Clock}
              palette={LOOK[event.kind]?.palette}
            />
          ))}

          {awaiting && (
            <Timeline.Item data-testid="restock-timeline-awaiting">
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator color="fg.muted" opacity={0.6}>
                  <Icon as={Clock} boxSize="4" />
                </Timeline.Indicator>
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title color="fg.muted">{t("restock.timeline.awaiting")}</Timeline.Title>
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
// THE PERSON LEADS (owner) — one row per step, read left to right: "Rina │ raised the request /
// Monday". Stacked, the face and its caption cost three lines per step and a four-step timeline
// scrolled; side by side it is one line each and the column of avatars becomes the thing you scan
// down.
//
// It degrades in the right direction: a step whose event records no actor simply starts at its title,
// because the flex row has nothing in its first slot rather than an empty box holding space — and the
// separator goes with it, since a divider dangling in front of a title reads as a missing avatar.
function EventStep({
  event,
  actor,
  fallback,
  title,
  icon,
  palette,
}: {
  event: RestockRequestEvent;
  actor?: PublicUser;
  fallback: string;
  title: string;
  icon: LucideIcon;
  palette?: string;
}) {
  const { t } = useTranslation();
  const testId = `restock-timeline-${kindSlug(event.kind)}`;

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
          {/* THE SHARED UserItem — avatar, name, @username — so a face here reads exactly as it does
              in the user list, the team members table and every search result. A hand-rolled "by
              Rina" is how two screens start disagreeing about what a person looks like. `w="auto"` /
              `maxW` because UserItem fills its container by default, which in a flex row would push
              the caption off the end entirely. */}
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`${testId}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            // An id that did not resolve still names its number — showing nothing would read as
            // "nobody did this", a different and false claim. An actor of 0 has no fallback and
            // correctly shows neither.
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
            {/* Date AND TIME: several restocks are raised in one morning, and a pending one can be
                edited three times in an afternoon — the day alone cannot put those in order. An event
                always has a moment (the column is NOT NULL), so unlike the column-derived version
                this has no "date not recorded" case to carry. */}
            <Timeline.Description>
              {event.atUnix > 0n
                ? formatUnixDateTime(event.atUnix)
                : t("restock.timeline.noDate")}
            </Timeline.Description>
          </Box>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}

// The testid segment per kind. Stable strings rather than the enum's number, so a selector reads
// `restock-timeline-accepted` and survives the enum gaining a value.
function kindSlug(kind: RestockRequestEventKind): string {
  switch (kind) {
    case RestockRequestEventKind.CREATED:
      return "created";
    case RestockRequestEventKind.EDITED:
      return "edited";
    case RestockRequestEventKind.ACCEPTED:
      return "accepted";
    case RestockRequestEventKind.CANCELLED:
      return "cancelled";
    case RestockRequestEventKind.COD_FEE:
      return "cod-fee";
    default:
      return "unknown";
  }
}
