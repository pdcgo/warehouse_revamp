import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE SHIP-BY DEADLINE — the marketplace's own "kirim sebelum", `Order.platform_shipment_deadline_unix`
// (the-shipment-deadline-is-the-platforms-and-optional). Nothing here computes it: the platform promised it, the app
// pushed it or the CS read it off the storefront. It is optional, so an order may simply have none.
//
// Why it shouts rather than sits in a column (owner: *"jika order punya deadline aku ingin dia mencolok"*): missing a
// marketplace's window costs the shop its rating — see a-deadline-is-loud-or-it-is-nothing.

/** How far from now, in hours. Negative is past due. */
export function hoursFromNow(unix: bigint, now: Date = new Date()): number {
  return (Number(unix) * 1000 - now.getTime()) / 3_600_000;
}

/** The four bands the cell colours by. */
export type Urgency = "overdue" | "urgent" | "today" | "later";

/**
 * THE TWO BOUNDARIES ARE THE OWNER'S, AND FIXED (the-urgency-bands-are-6-and-24-hours): urgent within 6 hours —
 * before the next shift — and today within 24. Urgency is how long the warehouse has left, not which courier carries
 * the parcel, so there is no setting and no per-channel field. Named here, once.
 */
export const URGENT_WITHIN_HOURS = 6;
export const TODAY_WITHIN_HOURS = 24;

export function deadlineUrgency(hours: number): Urgency {
  if (hours < 0) {
    return "overdue";
  }

  if (hours <= URGENT_WITHIN_HOURS) {
    return "urgent";
  }

  if (hours <= TODAY_WITHIN_HOURS) {
    return "today";
  }

  return "later";
}

/**
 * The order's LIVE deadline — or `undefined` when it has none, or when the question no longer applies.
 *
 * ⚠ THE CLOCK STOPS AT HANDOVER. An order handed to the courier (`shipping`) or past that, or cancelled, has no live
 * deadline: a column that stayed red on orders already out of the building would be a column people learn to ignore.
 */
export function orderDeadline(order: { status: OrderStatus; platformShipmentDeadlineUnix: bigint }): bigint | undefined {
  const live =
    order.status === OrderStatus.PENDING ||
    order.status === OrderStatus.PROCESSED ||
    order.status === OrderStatus.PICKED;

  return live && order.platformShipmentDeadlineUnix > 0n ? order.platformShipmentDeadlineUnix : undefined;
}

/** When the buyer ordered on the storefront, or `undefined` for an order placed before the field existed. */
export function orderPlatformDate(order: { platformCreatedAtUnix: bigint }): bigint | undefined {
  return order.platformCreatedAtUnix > 0n ? order.platformCreatedAtUnix : undefined;
}
