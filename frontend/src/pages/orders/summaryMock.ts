import type { OrderSummaryRow } from "../../features/orders/stat";

// THE FIVE COLUMNS THE CONTRACT DOES NOT CARRY, INVENTED SO THE LAYOUT CAN BE LOOKED AT.
//
// `OrderStatusCount` sums `total` and nothing else — no marketplace value, no cost, no fees, no line
// count — so `orderSummaryRows` returns `null` for those five and `OrderSummary` draws an em-dash. That is the
// honest rendering, and it is also a strip of dashes nobody can judge a layout from.
//
// ⚠ EVERY NUMBER THIS PRODUCES IS MADE UP, and the screen says so: `summaryCost` and `summaryItems`
// in `pending.ts` are the marks, and they sit on the summary itself. Delete this file the day the
// three sums land on `OrderStatusCount` — it exists only to make a preview previewable, exactly as
// `mockTerms` does on the order form.
//
// ⚠ IT IS DERIVED FROM THE REAL `value`, NOT RANDOM. A random filler wobbles between renders, so a
// reader cannot tell a layout bug from noise. The ratios are fixed, so at least the strip does not
// move while you read it.
//
// ⚠ BUT IT DOES NOT RECONCILE WITH THE ROWS, AND IT CANNOT — measured, the strip lands about 11%
// above the sum of the table beneath it. This is worth stating rather than tuning away, because the
// gap IS the argument for making these census columns real:
//
//   the census gives this file Σ total and a COUNT, nothing else
//   so an excluded order can only be charged the pile's AVERAGE size
//   and the orders actually excluded here are not average — #108, the one with no marketplace figure,
//   is the largest of the nine
//
// Scaling a subset by the whole pile's average is the same mistake in a smaller costume as summing
// every order's revenue against only the priced orders' cost (which is what put a 36% margin at 48%
// and is fixed above). The difference is that THAT one was fixable here and this one is not: only the
// server knows the size of what it left out. Two earlier rounds of tuning constants closed the gap on
// the fixtures of the day and re-opened it the next time a fixture changed.
//
// So the numbers are the right SHAPE and the wrong SIZE, the strip carries its marks, and the fix is
// the census columns rather than a third ratio.

/**
 * Of our `total`, how much the MARKETPLACE actually took.
 *
 * ⚠ TUNED TO THE FIXTURES, not picked. Every fixture order's `marketplace_total` sits a little BELOW
 * our quote — the platform's vouchers and coin subsidies come off the buyer's payment — and 98% is
 * what those eight rows average. The strip derives it from the census, which carries only `total`,
 * while the TABLE reads each order's real `marketplace_total`, so a ratio that was not the fixtures'
 * own would have the strip and the rows disagreeing about the same orders.
 */
const MP_OF_TOTAL = 98n;

/** Of what the marketplace paid, how much the goods cost us. */
const COST_OF_MP = 62n;

/**
 * The warehouse's fee per order — the `biaya` inside total beli.
 *
 * ⚠ A FLAT FIGURE, matching `mockWarehouseFee`'s average (2.000 + 0–2.000 by order id), so the
 * strip's fee total and the table's per-row fees land in the same place.
 */
const FEE_PER_ORDER = 3_000n;

/** Units per order. Deliberately not a round 3 — a whole number would hide a broken UPT column. */
const ITEMS_PER_ORDER = 3.4;

/**
 * Which piles hold an order the margin CANNOT be taken over, and how many.
 *
 * ⚠ TWO ORDERS, TWO DIFFERENT ABSENCES, because the margin needs both facts: `#107` (cancelled) has
 * no recorded cost, and `#108` (shipped) has no marketplace figure. Counting only the first left the
 * strip claiming Rp 780.384 of margin where the rows beneath it summed to Rp 599.980 — the sample was
 * crediting #108 with revenue the row itself refuses to guess.
 *
 * ⚠ IT MUST BE THE PILES THE FIXTURES' GAPS ARE ACTUALLY IN. A sample that puts the gap in `processed`
 * while the table shows the em-dash on a cancelled row is a preview arguing with itself, and the whole
 * point of the strip is that it agrees with the rows.
 */
const UNMEASURABLE: Record<string, number> = { cancel: 1, shipped: 1 };

/** Fill the four unwired columns. The real `count` and `value` pass through untouched. */
export function withSampleCosts(row: OrderSummaryRow): OrderSummaryRow {
  // ⚠ A pile the contract has no status for gets NOTHING invented for it. Its figures are unknown,
  // not zero and not sampled — see `onTheWire`.
  if (!row.onTheWire) {
    return row;
  }

  if (row.count === 0) {
    // Nothing in this status: zeroes here are real, not unknown, so the row reads as empty rather
    // than as four dashes that look like a loading failure.
    return { ...row, mpValue: 0n, cogs: 0n, fees: 0n, marginUnknown: 0, itemCount: 0 };
  }

  const marginUnknown = Math.min(UNMEASURABLE[row.key] ?? 0, row.count);

  // ⚠ ALL THREE SUMS COVER THE MEASURABLE ORDERS ONLY — the contract proposal says so and the sample has to
  // obey it, or the preview would show a margin the real thing could never produce. Taking every
  // order's goods against only the measurable orders' cost is what turned 36% into 48% on the first
  // render, and the Picking row into a confident 100%.
  const measured = BigInt(row.count - marginUnknown);
  const mpValue = ((row.value * MP_OF_TOTAL) / 100n / BigInt(row.count)) * measured;

  return {
    ...row,
    mpValue,
    cogs: (mpValue * COST_OF_MP) / 100n,
    fees: FEE_PER_ORDER * measured,
    marginUnknown,
    itemCount: Math.round(row.count * ITEMS_PER_ORDER),
  };
}
