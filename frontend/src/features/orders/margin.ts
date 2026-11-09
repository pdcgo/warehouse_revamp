// GROSS MARGIN — one arithmetic, two shapes.
//
// The summary strip takes it over a PILE of orders (`OrderSummaryRow`) and the table takes it over
// ONE (`Order`). The fields differ, the rule must not: a margin that is 36% in the card and 44% in
// the row beneath it is two screens disagreeing about the same orders, which is the drift CLAUDE.md
// names. So the subtraction, the division and the rounding live here and nothing re-types them.
//
// ⚠ THE FORMULA IS THE OWNER'S (owner, 2026-09-28; an-order-records-no-shipping-cost):
//
//   total beli = subtotal produk (the COST of the goods) + biaya (the warehouse's fee)
//              = `goods_cost` + `warehouse_fee` = the order's `total_cost`
//   margin     = harga MP − total beli
//   persentase = margin ÷ harga MP
//
// Three things follow, and each one is a trap if it is missed:
//
//   1. THE REVENUE IS THE MARKETPLACE'S FIGURE, not ours. `platform_total` is what the buyer
//      actually paid the platform after its vouchers and subsidies. Dividing by any figure of ours would
//      flatter every discounted order.
//   2. THE FEE IS INSIDE THE COST. The warehouse's per-order fee is part of what the order cost us,
//      so it sits at the BOTTOM of the subtraction. An earlier version left it out and called the
//      result "margin kotor" — that overstated every order by the fee.
//   3. THE PERCENTAGE IS OF THE REVENUE, not of the cost. `margin ÷ harga MP` is the share of the
//      sale we kept; `margin ÷ beli` would be a mark-up, a different number that reads the same.
//
// ⚠ IT SUPERSEDES `subtotal − cogs`, which is what this file computed until the owner corrected it — the proto's
// old `margin = total − cogs − shipping_cost`, which measured our quote against our cost and never looked at what the
// platform paid. Selling 00027 dropped those columns. Kept nowhere: one formula, or two screens disagree.
//
// ⚠ THE GOODS ARE COSTED AS THE SELLER PAYS FOR THEM: `goods_cost` is Σ the lines' frozen `total`, a borrowed line WITH
// its owner's markup (the-cross-charge-lives-on-the-line). A line's harga beli is therefore `unit_cost_with_markup` —
// `lineUnitBeli` below — so the lines of an order add up to its goods_cost.
//
// ⚠ IT IS NOT PROFIT. Everything the marketplace deducts beyond the price is still outside it.
// Label it as margin wherever it is shown.
//
// ⚠ EVERY FIGURE IS AN EXACT DOUBLE (the-backend-never-rounds-money): `platform_total` since selling 00041, `goods_cost`
// and the lines' `unit_cost` since 00042, and `warehouse_fee` — each frozen EXACT when the order was placed. So the
// arithmetic here is plain `number`, the server's own, and a fraction shows on screen
// (a-fraction-of-a-rupiah-shows-three-decimals). Nothing here rounds.

import { type Rupiah, signOfRupiah } from "../../lib/money";

/** A Rupiah as a plain number — a bigint taken exactly, a NaN or an infinity as 0. */
function asNumber(amount: Rupiah): number {
  if (typeof amount === "bigint") return Number(amount);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * THE WAREHOUSE'S FEE ON ONE ORDER, as the margin arithmetic takes it — or `null` when it was NEVER PRICED.
 *
 * `Order.warehouse_fee` is frozen at create (`the-flat-rate-is-dropped-last`, step 3), unrounded, as a double. Absent
 * means the order was placed before fees were frozen, which is unknown rather than free — so it is `null` here and
 * the total beli it belongs to refuses, exactly as an unknown cost does. Taken as it was priced: no rounding.
 */
export function orderFee(order: { warehouseFee?: number }): number | null {
  return order.warehouseFee === undefined ? null : order.warehouseFee;
}

/** An order line as the money below reads it — `OrderItem`'s frozen figures. */
export interface LineMoney {
  quantity: number;
  /** The drawn cost of one unit, frozen exact (a double). 0 = UNKNOWN, not free. */
  unitCost: number;
  /** One unit at the owner's markup — absent on a line frozen before selling 00025. Unrounded. */
  unitCostWithMarkup?: number;
  /** The line's frozen total, the markup in — absent on a line frozen before selling 00023. */
  total?: number;
}

/**
 * ONE LINE'S HARGA BELI — what one unit cost the SELLER: the owner's cost plus the owner's markup on a borrowed line,
 * the drawn cost on an own line (where the two are equal). `unit_cost_with_markup` as frozen (unrounded — it shows its
 * fraction); a line frozen before it existed falls back to `unit_cost`.
 */
export function lineUnitBeli(line: LineMoney): number {
  return line.unitCostWithMarkup ?? line.unitCost;
}

/** One line's total at harga beli — its frozen `total`, unrounded; `unit_cost × qty` on a line frozen before it. */
export function lineTotalBeli(line: LineMoney): number {
  return line.total ?? line.unitCost * line.quantity;
}

/**
 * THE GOODS' COST, summed off the lines — the order's `goods_cost` as its lines spell it: Σ the frozen line totals,
 * EXACT, as the server freezes the header (the-backend-never-rounds-money) — the lines and the header agree within the
 * tolerance.
 */
export function linesGoodsCost(lines: LineMoney[]): number {
  return lines.reduce((sum, line) => sum + lineTotalBeli(line), 0);
}

/**
 * `cost of goods + fees`, or `null` when the cost is not a measurement.
 *
 * `costKnown` is the CALLER's answer to "is this cost real?", because the two callers answer it
 * differently and neither can answer for the other:
 *
 *   one order → `goodsCost > 0`; a 0 means the goods were never restocked through this system, which is
 *               UNKNOWN and not free (`order.proto`).
 *   a pile    → whether ANY order in it can be measured at all (`summaryHasMeasured`, a cost AND a
 *               platform figure); a pile may hold a positive sum and still be missing members.
 *
 * ⚠ A `null` HERE POISONS EVERYTHING DOWNSTREAM, deliberately. Without the cost there is no total
 * beli, so there is no margin and no percentage either — and an order whose cost nobody recorded must
 * read as unmeasured rather than as unusually profitable.
 */
export function orderSpend(goodsCost: Rupiah, fees: Rupiah, costKnown: boolean): number | null {
  return costKnown ? asNumber(goodsCost) + asNumber(fees) : null;
}

/**
 * `harga MP − total beli`, or `null` when either side is missing.
 *
 * ⚠ A `revenue` OF 0 IS NOT A SALE OF NOTHING — `platform_total` is 0 when nobody wrote down what
 * the storefront took (`order.proto`), so the margin is unknown rather than a loss of the whole cost.
 * That is the one case where a plausible-looking number would be most wrong: a full-price order would
 * read as −100%. A revenue that is not above 0 (float dust included) counts as not recorded too.
 */
export function orderMargin(revenue: Rupiah, spend: number | null): number | null {
  const sale = asNumber(revenue);

  if (spend === null || signOfRupiah(sale) <= 0) {
    return null;
  }

  return sale - spend;
}

/** The same, as a share OF THE REVENUE. One decimal, truncated toward zero (as the bigint tenths once were). */
export function orderMarginPct(revenue: Rupiah, spend: number | null): number | null {
  const margin = orderMargin(revenue, spend);
  const sale = asNumber(revenue);

  if (margin === null || signOfRupiah(sale) <= 0) {
    return null;
  }

  // In tenths of a percent; toPrecision(15) clears binary dust so 33.3 is not cut to 33.2.
  // `|| 0` turns a −0 into 0, so a margin of nothing never reads "−0%".
  return Math.trunc(Number(((margin * 1000) / sale).toPrecision(15))) / 10 || 0;
}

/** The percentage as the app writes it — id-ID, one decimal, no trailing zero noise. */
export function formatMarginPct(pct: number | null): string | null {
  return pct === null ? null : `${pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}
