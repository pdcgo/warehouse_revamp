import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE SHIP-BY DEADLINE — invented whole, because no order has one (owner: *"jika order punya deadline
// aku ingin dia mencolok"*).
//
// What it stands in for is real and specific: every marketplace gives a seller a window to hand the
// parcel to a courier, and missing it costs the shop its rating — which is why the owner wants it to
// SHOUT rather than sit in a column. Nothing in the contract carries it:
//
//   `Order` has no deadline, no SLA, no promised-ship date
//   `ShipmentChannel` has no lead time
//   `OrderEvent` records what HAPPENED, never what is due
//
// ⚠ DELETE THIS FILE the day the field lands. Every number it produces is a lie with an end date.
//
// ⚠ IT IS ANCHORED ON NOW, NOT ON THE ORDER — and that is the one deliberate compromise here. Anchored
// on `created_at` every fixture would be days overdue at once (the newest is a day old, and a real SLA
// is hours), so the whole column would be one shade of red and the four urgency bands could never be
// looked at. Anchoring on the clock gives the preview one row in each band, which is what a preview is
// for. ⚠ It also means the bands MOVE while the page is open, so a story asserting on a band has to
// compute it the same way rather than hard-coding a label.

/** How far from now, in hours. Negative is past due. */
export function hoursFromNow(unix: bigint, now: Date = new Date()): number {
  return (Number(unix) * 1000 - now.getTime()) / 3_600_000;
}

/**
 * The four bands the cell colours by.
 *
 * ⚠ THE BOUNDARIES ARE A GUESS and should be the owner's: 6 hours is "you cannot leave this for the
 * next shift" and 24 is "it is today's problem". Both are stated here rather than buried in the
 * component so there is one line to change.
 */
export type Urgency = "overdue" | "urgent" | "today" | "later";

export function deadlineUrgency(hours: number): Urgency {
  if (hours < 0) {
    return "overdue";
  }

  if (hours <= 6) {
    return "urgent";
  }

  if (hours <= 24) {
    return "today";
  }

  return "later";
}

/**
 * Hours from now, per order — chosen so the preview holds one row in every band.
 *
 * ⚠ FIVE VALUES, DERIVED FROM THE ID, never random: a badge that changed colour between renders is the
 * one thing nobody could sanity-check, and a reader could not tell a layout bug from noise.
 */
const OFFSET_HOURS = [-9, 2, 11, 30, 73];

/**
 * When this order has to be out — or `undefined` when the question no longer applies.
 *
 * ⚠ A SHIPPED, COMPLETED OR CANCELLED ORDER HAS NO LIVE DEADLINE, and that absence is the point rather
 * than a gap in the sample: the clock stops when the parcel leaves. A column that stayed red on orders
 * already out of the building would be a column people learn to ignore.
 */
export function mockDeadline(id: bigint, status: OrderStatus, now: Date = new Date()): bigint | undefined {
  const live =
    status === OrderStatus.PLACED ||
    status === OrderStatus.CONFIRMED ||
    status === OrderStatus.PICKING ||
    status === OrderStatus.PACKED;

  if (!live) {
    return undefined;
  }

  const hours = OFFSET_HOURS[Number(id) % OFFSET_HOURS.length]!;

  return BigInt(Math.floor(now.getTime() / 1000) + hours * 3600);
}
