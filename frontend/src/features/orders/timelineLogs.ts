import type { OrderTimelineLog } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus, OrderTimelineFrom } from "../../gen/warehouse/selling/v1/order_pb";

// AN ORDER'S TIMELINE ROWS ARE TWO THINGS (a-note-is-a-timeline-row): a STATUS row — the order moved, its reason in
// `note` when the move needed one — and a NOTE row, with no status at all, written by either side and never edited.
//
// `OrderDetail` returns both in one list. The detail splits them: the notes go to Catatan, the status rows to the
// Timeline. Splitting here, once, is what keeps the two screens that read them (the order detail and the pick
// screen) from disagreeing about which row is which.

/** A row with NO status — a note, not a move. */
export function isNoteLog(log: OrderTimelineLog): boolean {
  return log.status === OrderStatus.UNSPECIFIED;
}

/**
 * The order's notes, NEWEST FIRST. The latest instruction is the one somebody needs to read first; a tie on the
 * second falls back to the id, which the server hands out in writing order.
 */
export function orderNotes(logs: OrderTimelineLog[]): OrderTimelineLog[] {
  return logs
    .filter(isNoteLog)
    .sort((a, b) => Number(b.createdAtUnix - a.createdAtUnix) || Number(b.id - a.id));
}

/**
 * The status rows, in the order the server returned them (oldest first).
 *
 * ⚠ FILTER BEFORE INDEXING. A `pending` row past the first is a hand-back (`timelineTitleKey`), so a note written in
 * the same transaction as the order — the create form's note — must not push the placement to index 1.
 */
export function statusLogs(logs: OrderTimelineLog[]): OrderTimelineLog[] {
  return logs.filter((log) => !isNoteLog(log));
}

/** The i18n key of the side that wrote a row — a status row or a note — or "" when it is not recorded. */
export function timelineFromKey(from: OrderTimelineFrom): string {
  if (from === OrderTimelineFrom.WAREHOUSE) return "orders.timeline.from.warehouse";
  if (from === OrderTimelineFrom.SELLING) return "orders.timeline.from.selling";

  return "";
}
