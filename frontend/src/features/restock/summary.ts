import type {
  RestockRequest,
  RestockRequestItem,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockCostKind,
  RestockDamageType,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";

// What a restock's LINES add up to — the numbers both restock lists put in a row.
//
// They live here rather than in either page because the selling list and the warehouse list ask the
// same arithmetic of the same message, and two copies of "sum the lines" is how one screen starts
// counting damaged units and the other does not.

// How many pieces were ASKED FOR, across every line.
export function askedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.quantity, 0n);
}

// How many pieces actually ENTERED STOCK, across every line. 0 until the warehouse has counted, so
// it only says anything once the request is FULFILLED — see shortfall().
export function receivedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.receivedQuantity, 0n);
}

// WHAT WENT WRONG WITH A LINE, split the way #154 split it — and the split is the whole point for a
// buyer: "they sent it crushed" and "they never sent it" are two different conversations with a
// supplier. One is a claim on damaged goods, the other is a re-send. A single "short by 3" cannot
// tell them apart, which is why these are two functions and two columns rather than one total.
//
// Neither ever entered stock (owner, 2026-07-20): `received_quantity` counts what is SELLABLE, so
// these sit beside it and are never subtracted from it.
export function brokenQuantity(item: RestockRequestItem): bigint {
  return item.damaged
    .filter((d) => d.type === RestockDamageType.BROKEN)
    .reduce((sum, d) => sum + d.quantity, 0n);
}

export function lostQuantity(item: RestockRequestItem): bigint {
  return item.damaged
    .filter((d) => d.type === RestockDamageType.LOST)
    .reduce((sum, d) => sum + d.quantity, 0n);
}

// WHY, as the person at the door wrote it down. Every damaged entry carries a required non-empty
// reason (#154) — it is the difference between a loss that gets chased and a number nobody can act on
// — so the screen that shows the quantity shows the reason with it. Several entries of one type are
// joined, because a line can be crushed for two different reasons.
export function damageReasons(item: RestockRequestItem, type: RestockDamageType): string {
  return item.damaged
    .filter((d) => d.type === type)
    .map((d) => d.reason)
    .filter((r) => r !== "")
    .join(" · ");
}

// What the GOODS cost — the line totals as typed off the invoice (#140), with no freight in them.
export function goodsTotal(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.totalPrice, 0n);
}

// The slug the tests reach for — only an id, stable even if the wording changes.
//
// ⚠ THERE IS ONE KIND NOW (an-incidental-line-must-say-what-it-was-for), so this no longer
// distinguishes one cost row from another. It was already ambiguous for two `other` lines and is now
// ambiguous for all of them; what tells a row apart is its NOTE, which is required for exactly that
// reason.
export function costKindSlug(kind: RestockCostKind): string {
  switch (kind) {
    case RestockCostKind.INCIDENTAL:
      return "incidental";
    default:
      return "unknown";
  }
}

// WHAT THE WAREHOUSE LAID OUT to receive this delivery (00021) — the fee at the door, and anything
// else it paid to get the goods in.
//
// It is empty until a warehouse accepts, because none of these exist until the goods turn up. Every
// screen that shows a restock's cost reads it through here rather than summing the lines itself: the
// selling detail, the warehouse detail and the two lists must not disagree about what a delivery cost.
export function warehouseOutlay(request: RestockRequest): bigint {
  return request.costLines.reduce((sum, line) => sum + line.amount, 0n);
}

// What the whole restock has COMMITTED — goods plus every freight charge on them.
//
// The warehouse's outlay is empty until acceptance (#155), so this is the ordered value while pending
// and the landed value once accepted. It is deliberately NOT re-based on what arrived: the stored line
// total is the number off the invoice, and scaling it by received/asked would invent a per-piece
// rounding nobody typed. A short delivery is reported as a SHORTFALL beside the value instead — see
// below.
export function committedValue(request: RestockRequest): bigint {
  return goodsTotal(request.items) + request.shippingCost + warehouseOutlay(request);
}

// How many pieces the delivery came UP SHORT, or 0.
//
// Only a FULFILLED request can be short: before acceptance `received_quantity` is 0 on every line,
// which is the absence of a count and not a delivery of nothing — reading it earlier would flag
// every pending restock as a total loss.
//
// Over-delivery (11 against 10 asked) is real and returns 0 here rather than a negative: this
// answers "did I get less than I paid for", which is the question a buyer chases a supplier about.
export function shortfall(request: RestockRequest): bigint {
  if (request.status !== RestockRequestStatus.FULFILLED) return 0n;

  const short = askedQuantity(request.items) - receivedQuantity(request.items);

  return short > 0n ? short : 0n;
}
