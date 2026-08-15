import type { PickedProduct } from "../../components/ProductSelect";

// The order domain's line arithmetic — SHARED, because two screens compose order lines: the order
// form (#90) and the draft detail (#196). It sat in `pages/order-create/` while only one of them
// existed, and the second screen re-typed `toQty`/`toRupiah` rather than importing them, which is
// how one helper becomes two that disagree. A file used by several pages of one domain belongs in
// `features/` (CLAUDE.md).

// What a pick from the chosen warehouse would find, keyed by product id as a string. Complete for
// every id asked about — a product with nothing is a 0, not a gap — so `undefined` here means the
// answer has not arrived, never "none".
export type Availability = Map<string, bigint>;

// productId -> HPP at the chosen warehouse, in whole rupiah. Absent or 0 = UNKNOWN, never free.
export type Costs = Map<string, bigint>;

// One order line, as a screen holds it while it is being edited.
//
// ⚠ THIS TYPE CARRIES NO IDENTITY, deliberately — the two screens that compose lines disagree about
// what identifies one, and that disagreement is real rather than accidental:
//
//   • the ORDER FORM keys by PRODUCT (#165) — the picker hands back a ticked set, so one line per
//     product is what keeps the ticks and the rows two views of one list. The trade: the same
//     product cannot appear twice at two prices, which the contract allows and the form does not.
//   • a DRAFT keys by ROW — each line is one thing the scraper read, so an unmapped line (product 0)
//     is legal, two rows can map to the same product, and the row survives being re-mapped.
//
// So each screen holds its own line record with its own key and passes the fields below to these
// helpers. Anything that needed the identity would belong on the screen, not here.
//
// The numeric fields are kept as strings while editing (an empty input is not 0) and parsed on use.
//
export interface LineDraft {
  productId: bigint;
  sku: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  quantity: string;
}

// A fresh line for a newly ticked product. Quantity 1 rather than blank: one is what somebody who
// just ticked a product means, and a blank number field reads as a thing you forgot to fill in.
export function lineFor(p: PickedProduct): LineDraft {
  return {
    productId: p.id,
    sku: p.sku,
    name: p.name,
    imageUrl: p.defaultImageUrl ?? "",
    thumbnailUrl: p.defaultImageThumbnailUrl ?? "",
    quantity: "1",
  };
}

// Whole rupiah only: parse an input string to a non-negative int64, treating blank/invalid as 0.
export function toRupiah(raw: string): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.trunc(n));
}

export function toQty(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 0;
  return n;
}

// What this line is worth AT COST. The price is not typed any more — an order is valued at the HPP
// the warehouse recorded (owner) — so the cost map is an argument rather than a field on the draft:
// it belongs to the warehouse, changes when the warehouse changes, and must not be copied onto a row
// where it could go stale.
//
// An UNKNOWN cost (absent, or 0) contributes NOTHING rather than guessing. Understating a subtotal is
// visible and recoverable; inventing a price is neither.
export function lineTotal(line: LineDraft, costs: Costs | undefined): bigint {
  return BigInt(toQty(line.quantity)) * unitCost(line, costs);
}

// The HPP for one line, or 0n when nobody has recorded one.
export function unitCost(line: LineDraft, costs: Costs | undefined): bigint {
  return costs?.get(line.productId.toString()) ?? 0n;
}

// Whether the warehouse has a recorded cost for this product at all. 0 means UNKNOWN, never free, so
// the two cases are told apart HERE rather than by every caller re-deriving the rule.
export function costKnown(line: LineDraft, costs: Costs | undefined): boolean {
  return costs !== undefined && (costs.get(line.productId.toString()) ?? 0n) > 0n;
}

// What this form knows about a product's stock in the chosen warehouse.
//
// THREE states, not two, and the third is the one that matters: "we have not been told" is not "we
// have none". A form that renders a confident 0 because the read failed, or because nobody has picked
// a warehouse yet, would have people refusing orders they could fill.
export type LineStock =
  | { kind: "unknown" }
  | { kind: "known"; ready: bigint; wanted: bigint; short: boolean };

// Reads one line's stock position out of the warehouse's answer.
//
// `stock === undefined` is the read not having happened (no warehouse, still loading, or it failed) —
// unknown, and the form says nothing rather than inventing a zero.
export function lineStock(line: LineDraft, stock: Availability | undefined): LineStock {
  if (stock === undefined || line.productId <= 0n) {
    return { kind: "unknown" };
  }

  const ready = stock.get(line.productId.toString()) ?? 0n;
  const wanted = BigInt(toQty(line.quantity));

  return { kind: "known", ready, wanted, short: wanted > ready };
}

// Whether the form may be submitted at all.
//
// The stock check is deliberately NOT part of this when stock is unknown: the server refuses an
// order it cannot fill either way (the pick and the order write are one transaction), so a form that
// blocked on a failed read would turn a degraded read into a hard stop on a perfectly placeable order.
export function canSubmit(args: {
  customerName: string;
  shopId: bigint;
  warehouseId: bigint;
  lines: LineDraft[];
  stock: Availability | undefined;
}): boolean {
  const { customerName, shopId, warehouseId, lines, stock } = args;

  if (customerName.trim() === "" || shopId <= 0n || warehouseId <= 0n || lines.length < 1) {
    return false;
  }

  if (!lines.every((l) => l.productId > 0n && toQty(l.quantity) >= 1)) {
    return false;
  }

  return !lines.some((l) => {
    const s = lineStock(l, stock);
    return s.kind === "known" && s.short;
  });
}
