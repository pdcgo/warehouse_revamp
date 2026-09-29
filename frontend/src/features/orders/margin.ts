// GROSS MARGIN — one arithmetic, two shapes.
//
// The summary strip takes it over a PILE of orders (`OrderSummaryRow`) and the table takes it over
// ONE (`Order`). The fields differ, the rule must not: a margin that is 36% in the card and 44% in
// the row beneath it is two screens disagreeing about the same orders, which is the drift CLAUDE.md
// names. So the subtraction, the division and the rounding live here and nothing re-types them.
//
// ⚠ THE FORMULA IS THE OWNER'S, AND IT IS NOT THE PROTO'S (owner, 2026-09-28):
//
//   total beli = subtotal produk (the COST of the goods) + biaya (the warehouse's fee)
//   margin     = harga MP − total beli
//   persentase = margin ÷ harga MP
//
// Three things follow, and each one is a trap if it is missed:
//
//   1. THE REVENUE IS THE MARKETPLACE'S FIGURE, not ours. `marketplace_total` is what the buyer
//      actually paid the platform after its vouchers and subsidies; our `subtotal` is what we quoted.
//      Dividing by ours would flatter every discounted order.
//   2. THE FEE IS INSIDE THE COST. The warehouse's per-order fee is part of what the order cost us,
//      so it sits at the BOTTOM of the subtraction. An earlier version left it out and called the
//      result "margin kotor" — that overstated every order by the fee.
//   3. THE PERCENTAGE IS OF THE REVENUE, not of the cost. `margin ÷ harga MP` is the share of the
//      sale we kept; `margin ÷ beli` would be a mark-up, a different number that reads the same.
//
// ⚠ IT SUPERSEDES `subtotal − cogs`, which is what this file computed until the owner corrected it —
// and which happens to be the proto's own `margin = total − cogs − shipping_cost`. That definition
// measures our quote against our cost and never looks at what the platform paid. Kept nowhere: one
// formula, or two screens disagree.
//
// ⚠ IT IS NOT PROFIT. Everything the marketplace deducts beyond the price is still outside it.
// Label it as margin wherever it is shown.

/**
 * `cost of goods + fees`, or `null` when the cost is not a measurement.
 *
 * `costKnown` is the CALLER's answer to "is this cost real?", because the two callers answer it
 * differently and neither can answer for the other:
 *
 *   one order → `cogs > 0n`; a 0 means the goods were never restocked through this system, which is
 *               UNKNOWN and not free (`order.proto`).
 *   a pile    → whether ANY order in it can be measured at all (`summaryHasMeasured`, a cost AND a
 *               marketplace figure); a pile may hold a positive sum and still be missing members.
 *
 * ⚠ A `null` HERE POISONS EVERYTHING DOWNSTREAM, deliberately. Without the cost there is no total
 * beli, so there is no margin and no percentage either — and an order whose cost nobody recorded must
 * read as unmeasured rather than as unusually profitable.
 */
export function orderSpend(cogs: bigint, fees: bigint, costKnown: boolean): bigint | null {
  return costKnown ? cogs + fees : null;
}

/**
 * `harga MP − total beli`, or `null` when either side is missing.
 *
 * ⚠ A `revenue` OF 0 IS NOT A SALE OF NOTHING — `marketplace_total` is 0 when nobody wrote down what
 * the storefront took (`order.proto`), so the margin is unknown rather than a loss of the whole cost.
 * That is the one case where a plausible-looking number would be most wrong: a full-price order would
 * read as −100%.
 */
export function orderMargin(revenue: bigint, spend: bigint | null): bigint | null {
  if (spend === null || revenue <= 0n) {
    return null;
  }

  return revenue - spend;
}

/** The same, as a share OF THE REVENUE. One decimal, computed in tenths to stay in bigint. */
export function orderMarginPct(revenue: bigint, spend: bigint | null): number | null {
  const margin = orderMargin(revenue, spend);

  if (margin === null || revenue <= 0n) {
    return null;
  }

  return Number((margin * 1000n) / revenue) / 10;
}

/** The percentage as the app writes it — id-ID, one decimal, no trailing zero noise. */
export function formatMarginPct(pct: number | null): string | null {
  return pct === null ? null : `${pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}
