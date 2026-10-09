import type {
  RestockRequest,
  RestockRequestItem,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockProblemType,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";

// What a restock's LINES add up to — the numbers both restock lists and both detail pages read.
//
// They live here rather than in any page because the selling and warehouse screens ask the same arithmetic of the
// same message, and two copies of "sum the lines" is how one screen starts counting broken units and the other does
// not. The decisions are docs/business/inventory/restock_decision.md.

// How many pieces were ORDERED, across every line.
export function askedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.count, 0n);
}

// How many pieces were IN THE BOX, broken ones included (any-warehouse-member-counts-what-arrived). 0 until the
// warehouse has counted, so it only says anything once the restock is ACCEPTED.
export function receivedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.receivedCount, 0n);
}

// How many pieces of one line came broken / were missing from the box. The PROBLEM TABLE says these happened at the
// door, so the selling team bears them (a-loss-is-named-by-where-it-happened).
export function brokenQuantity(item: RestockRequestItem): bigint {
  return problemCount(item, RestockProblemType.BROKEN);
}

export function missingQuantity(item: RestockRequestItem): bigint {
  return problemCount(item, RestockProblemType.MISSING);
}

function problemCount(item: RestockRequestItem, type: RestockProblemType): bigint {
  return item.problems.filter((p) => p.type === type).reduce((sum, p) => sum + p.count, 0n);
}

// The good units of one line — what became stock. Received minus broken; never typed.
export function goodQuantity(item: RestockRequestItem): bigint {
  const good = item.receivedCount - brokenQuantity(item);

  return good > 0n ? good : 0n;
}

// What the warehouse wrote on a broken or missing row (three-notes-one-writer-each) — optional, so often "".
export function problemNotes(item: RestockRequestItem, type: RestockProblemType): string {
  return item.problems
    .filter((p) => p.type === type)
    .map((p) => p.note)
    .filter((n) => n !== "")
    .join(" · ");
}

// What a line's broken / missing units were worth — FILLED BY THE SYSTEM from the line, never typed
// (the-problem-price-is-filled-by-the-system).
export function problemValue(item: RestockRequestItem, type: RestockProblemType): bigint {
  return item.problems.filter((p) => p.type === type).reduce((sum, p) => sum + p.total, 0n);
}

// What the GOODS cost — the line totals as typed off the invoice (a-line-is-typed-as-its-total), no freight.
export function goodsTotal(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.total, 0n);
}

// The courier's charge at the door: paid by the warehouse, owed back by the selling team
// (the-warehouse-cost-is-the-couriers-charge-at-the-door). 0 until accepted. Never part of the total.
export function courierCharge(request: RestockRequest): bigint {
  return request.warehouseAdditionalCost;
}

// What the selling team PAID when it raised the restock — goods plus shipping, the amount its account was charged.
// The courier's charge is NOT in it (the-couriers-charge-stays-out-of-total): the warehouse paid that, later, and it
// is owed back as its own debt.
export function committedValue(request: RestockRequest): bigint {
  return goodsTotal(request.items) + request.shipmentCost;
}

// How many pieces were MISSING from the box, across every line — the shortfall a buyer chases the supplier about. Only
// an accepted restock has a count; before that nothing is missing, it simply has not been counted.
export function shortfall(request: RestockRequest): bigint {
  if (request.status !== RestockRequestStatus.ACCEPTED) return 0n;

  return request.items.reduce((sum, item) => sum + missingQuantity(item), 0n);
}
