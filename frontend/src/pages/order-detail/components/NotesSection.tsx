import { useState } from "react";
import { Box, Button, Flex, Icon, Stack, Text, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import type { OrderTimelineLog } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderTimelineFrom } from "../../../gen/warehouse/selling/v1/order_pb";
import type { PublicUser } from "../../../gen/warehouse/user/v1/user_pb";
import { useCreateOrderNote } from "../../../features/orders/queries";
import { orderNotes, timelineFromKey } from "../../../features/orders/timelineLogs";
import { formatUnixDateTime } from "../../../lib/datetime";
import { SectionEmpty } from "./Section";

/** The contract's limit (`OrderNoteCreateRequest.note`): 1 to 500 characters, trimmed. */
export const NOTE_MAX = 500;

// CATATAN — THE ORDER'S NOTES (a-note-is-a-timeline-row): the timeline rows with no status, each with the side it
// came from, who wrote it and when. Either end adds one — the selling team and the warehouse that fulfils the order.
//
// ⚠ NEVER EDITED, NEVER DELETED. A note is usually an instruction somebody acts on ("titip bubble wrap", "stok kosong
// di Rak A"); letting it change under them would make the order say something different from what they read. A
// correction is a NEW note, so there is no pencil and no bin here — absent, not greyed.
//
// ⚠ NEWEST FIRST, COMPOSER ON TOP. The latest note is the one that governs, and it is what somebody needs to read
// first; the box to answer it sits right above it.
//
// ⚠ THE WRITER IS THE PAGE'S OWN ACTOR LOOKUP. `actors` is the one `useActors` read the page already makes for the
// timeline — the note rows are in the same `timeline_logs`, so their writers are already in it. A second lookup here
// would be the same people fetched twice.
/**
 * The team a viewer writes notes AS — the order's selling team or its warehouse — or `undefined` when it is neither
 * (Root and Administrator read every team's orders, but a note always comes from one of the order's two ends).
 */
export function noteWriter(teamId: bigint | undefined, order: { teamId: bigint; warehouseId: bigint }): bigint | undefined {
  return teamId !== undefined && (teamId === order.teamId || teamId === order.warehouseId) ? teamId : undefined;
}

export function NotesSection({
  teamId,
  orderId,
  logs,
  actors,
}: {
  /**
   * The team WRITING — the order's selling team or its warehouse; the server turns it into the note's side.
   * `undefined` = this viewer writes no notes, and the box is not drawn: Root reading another team's order is neither
   * end, and the server would refuse it (a-note-is-a-timeline-row). Use `noteWriter` to decide.
   */
  teamId: bigint | undefined;
  orderId: bigint;
  /** Every timeline row of the order, as `OrderDetail` returns them. The notes are picked out here. */
  logs: OrderTimelineLog[];
  /** The people behind the rows' actor ids, keyed by id as a string — the page's `useActors` result. */
  actors?: Map<string, PublicUser>;
}) {
  const { t } = useTranslation();
  const create = useCreateOrderNote();

  const [draft, setDraft] = useState("");

  const notes = orderNotes(logs);
  const text = draft.trim();
  const saving = create.isPending;

  // Names a writer. 0 is "not recorded" and names nobody; a set id the lookup has not resolved names its number,
  // exactly as the timeline does — showing nothing would read as "nobody wrote this".
  function writer(userId: bigint): string {
    if (userId === 0n) return "";

    return actors?.get(userId.toString())?.name ?? t("orders.timeline.userRef", { id: userId.toString() });
  }

  async function add() {
    if (teamId === undefined || text === "" || text.length > NOTE_MAX) {
      return;
    }

    try {
      await create.mutateAsync({ teamId, orderId, note: text });
      setDraft("");
    } catch (err) {
      // The draft STAYS on a failure, so nothing typed is lost to a refusal or a dropped connection.
      toaster.create({ type: "error", title: t("orderDetail.notes.failed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="card">
      {teamId !== undefined && (
        <Stack gap="2" data-testid="notes-composer">
          <Textarea
            value={draft}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder={t("orderDetail.notes.placeholder")}
            aria-label={t("orderDetail.notes.label")}
            disabled={saving}
            data-testid="notes-input"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Flex gap="2" align="center">
            {/* THE LIMIT, counted as it is typed — the box stops at it, so the count is what says why. */}
            <Text fontSize="xs" color="fg.muted" data-testid="notes-count">
              {t("orderDetail.notes.count", { used: draft.length, max: NOTE_MAX })}
            </Text>
            <Box flex="1" />
            <Button
              colorPalette="brand"
              disabled={text === "" || saving || teamId === undefined}
              loading={saving}
              data-testid="notes-add"
              onClick={() => void add()}
            >
              <Icon as={Plus} boxSize="4" />
              {t("orderDetail.notes.add")}
            </Button>
          </Flex>
        </Stack>
      )}

      {notes.length === 0 ? (
        <Box data-testid="notes-empty">
          <SectionEmpty>{t("orderDetail.notes.empty")}</SectionEmpty>
        </Box>
      ) : (
        <Stack gap="3" data-testid="notes-list">
          {notes.map((log, i) => {
            const who = writer(log.actorId);
            const fromKey = timelineFromKey(log.from);

            return (
              <Stack
                key={log.id > 0n ? log.id.toString() : `i${i}`}
                gap="0.5"
                ps="3"
                borderStartWidth="2px"
                borderColor="border"
                data-testid="order-note"
                data-from={fromSlug(log.from)}
              >
                <Flex gap="2" align="baseline" wrap="wrap">
                  {who && (
                    <Text fontSize="sm" fontWeight="bold" data-testid="order-note-by">
                      {who}
                    </Text>
                  )}
                  {/* WHICH SIDE, then when — the same words the timeline uses for a row's side. */}
                  <Text fontSize="xs" color="fg.muted" data-testid="order-note-meta">
                    {[fromKey ? t(fromKey) : "", formatUnixDateTime(log.createdAtUnix)].filter(Boolean).join(" · ")}
                  </Text>
                </Flex>
                {/* `pre-wrap` because it was typed as lines: three things on three lines stay three lines. */}
                <Text fontSize="sm" whiteSpace="pre-wrap" data-testid="order-note-text">
                  {log.note}
                </Text>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

/** A stable attribute value for the side, for a selector to read — never the enum's number. */
function fromSlug(from: OrderTimelineFrom): string {
  if (from === OrderTimelineFrom.WAREHOUSE) return "warehouse";
  if (from === OrderTimelineFrom.SELLING) return "selling";

  return "";
}
