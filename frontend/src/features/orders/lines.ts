import type { PickedProduct } from "../../components/products/ProductSelect";
import { formatRupiahNumber } from "../../lib/money";

// The order domain's line arithmetic — SHARED, because two screens compose order lines: the order
// form (#90) and the draft detail (#196). It sat in `pages/order-create/` while only one of them
// existed, and the second screen re-typed `toQty`/`toRupiah` rather than importing them, which is
// how one helper becomes two that disagree. A file used by several pages of one domain belongs in
// `features/` (CLAUDE.md).

// What a pick from the chosen warehouse would find, keyed by product id as a string. A product with
// nothing is a 0, not a gap. `undefined` — the whole map, or one product's entry — means the answer
// has not arrived for it, never "none".
export type Availability = Map<string, bigint>;

// One batch the take would draw from: `quantity × unitCost`, oldest first.
export interface DrawBatch {
  quantity: bigint;
  /** Rupiah per unit as this batch gives it up — unrounded (rupiah-is-floating-point). */
  unitCost: number;
}

// WHAT THE CHOSEN WAREHOUSE'S TAKE WOULD DRAW for one product — StockTakeQuote's answer
// (an-order-is-costed-at-what-leaves-the-shelf). An order is costed at the units that leave the shelf, the owner's
// batches oldest first, so the form previews that very draw and the order freezes the one it made. The shelf's
// average is never a line's cost.
export interface ProductDraw {
  /** The units the warehouse was asked about: the form's WHOLE quantity of this product, every line of it summed. */
  quantity: bigint;
  /** The units the take could draw for this order — the owner's, in this warehouse. */
  available: bigint;
  /** What those units cost, unrounded. `undefined` = the take would draw nothing (short, or refused): UNKNOWN. */
  total?: number;
  /** total ÷ quantity. */
  unitCost?: number;
  /** The batches behind `total`, oldest first. Empty when nothing would be drawn. */
  batches: DrawBatch[];
}

// productId -> what the take would draw at the chosen warehouse. A cost of 0, or none, is UNKNOWN — never free.
export type Costs = Map<string, ProductDraw>;

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

// ONE LINE PER PRODUCT — the grain the order is placed and costed at (the-order-keeps-only-product-lines). A screen
// may hold the same product twice (a bundle's slot beside a hand-picked line; two draft rows mapped to one product),
// but the server merges them into one line before the take, and the take draws — and prices — a product ONCE
// (an-order-is-costed-at-what-leaves-the-shelf). So every MONEY figure a screen shows is summed over this, never over
// the raw lines: two lines of one product priced apart round twice, and 1 + 2 units of 11.333,33 would read 11.333 +
// 22.667 where the order stores the one draw's 34.000. The rows on screen stay as they are; only the arithmetic merges.
//
// The first line's sku, name and images stand for the product; quantities that do not parse count as 0, as everywhere.
export function byProduct(lines: LineDraft[]): LineDraft[] {
  const merged = new Map<string, LineDraft>();

  for (const line of lines) {
    const key = line.productId.toString();
    const seen = merged.get(key);

    merged.set(
      key,
      seen ? { ...seen, quantity: String(toQty(seen.quantity) + toQty(line.quantity)) } : { ...line },
    );
  }

  return [...merged.values()];
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

function drawOf(line: LineDraft, costs: Costs | undefined): ProductDraw | undefined {
  return costs?.get(line.productId.toString());
}

// What this line is worth AT COST — what its units cost when they leave the shelf
// (an-order-is-costed-at-what-leaves-the-shelf). The price is not typed any more (owner), so the cost map is an
// argument rather than a field on the draft: it belongs to the warehouse, changes when the warehouse or a quantity
// changes, and must not be copied onto a row where it could go stale.
//
// The draw's own total when it was asked for exactly this line's quantity — 2 × 10.000 + 1 × 14.000 is 34.000, never
// 3 × a rounded 11.333. Otherwise (the product sits on two lines, or a new quantity is still being asked about) this
// line's share at the draw's unit cost.
//
// An UNKNOWN cost (none, or 0) contributes NOTHING rather than guessing. Understating a subtotal is
// visible and recoverable; inventing a price is neither.
export function lineTotal(line: LineDraft, costs: Costs | undefined): bigint {
  if (!costKnown(line, costs)) return 0n;

  const draw = drawOf(line, costs)!;
  const qty = toQty(line.quantity);

  if (BigInt(qty) === draw.quantity) return BigInt(Math.round(draw.total!));

  return BigInt(Math.round(draw.unitCost! * qty));
}

// The HPP for one line — what one of its units costs as the take would draw it, whole rupiah — or 0n when unknown.
export function unitCost(line: LineDraft, costs: Costs | undefined): bigint {
  return costKnown(line, costs) ? BigInt(Math.round(drawOf(line, costs)!.unitCost!)) : 0n;
}

// Whether the warehouse can say what this line costs at all. None, or 0, means UNKNOWN, never free — a short line
// (the take would draw nothing) and a batch nobody priced read the same — so the cases are told apart HERE rather
// than by every caller re-deriving the rule.
export function costKnown(line: LineDraft, costs: Costs | undefined): boolean {
  const total = drawOf(line, costs)?.total;
  return total !== undefined && total > 0;
}

// THE BATCHES BEHIND A LINE'S COST, when there is more than one to show — "2 × Rp 10.000 + 1 × Rp 14.000". Empty when
// one batch gives it all (its unit cost already says everything), when the cost is unknown, or when the draw was not
// asked for exactly this line's quantity: a split of a different number of units would describe a different draw.
export function costSplit(line: LineDraft, costs: Costs | undefined): DrawBatch[] {
  if (!costKnown(line, costs)) return [];

  const draw = drawOf(line, costs)!;
  if (draw.batches.length < 2 || draw.quantity !== BigInt(toQty(line.quantity))) return [];

  return draw.batches;
}

// A split as a line reads it — "2 × Rp 10.000 + 1 × Rp 14.000", oldest batch first. Arithmetic, so it reads the same
// in either language; each batch's price is whole rupiah on screen, as every other figure is.
export function formatCostSplit(split: DrawBatch[]): string {
  return split.map((b) => `${b.quantity.toString()} × ${formatRupiahNumber(b.unitCost)}`).join(" + ");
}

// What each product's take could draw, as the stock column reads it — the same answer the cost comes from, so the
// figure a quantity is judged against and the cost of that quantity never describe two different reads.
export function availabilityOf(costs: Costs | undefined): Availability | undefined {
  if (costs === undefined) return undefined;

  return new Map([...costs].map(([id, draw]) => [id, draw.available]));
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
// unknown, and the form says nothing rather than inventing a zero. So is a product the answer does not
// name: it was not asked about yet (a line just added, while the previous answer is still on screen).
export function lineStock(line: LineDraft, stock: Availability | undefined): LineStock {
  const ready = line.productId > 0n ? stock?.get(line.productId.toString()) : undefined;

  if (ready === undefined) {
    return { kind: "unknown" };
  }

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
