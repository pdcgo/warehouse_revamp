import type { OrderStatResponse } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderMargin, orderMarginPct, orderSpend } from "./margin";

// What the header above the order list needs, derived from OrderStat's census in ONE place.
//
// The server returns the raw per-status census and the 30-day money, and nothing else. Everything the
// tiles show beyond that — the work-queue groupings and the average order — is arithmetic over those
// numbers, done HERE rather than server-side: a tile that adds up rows the reader can also see cannot
// disagree with them, whereas a second server-computed figure could drift the moment either
// definition moved.
export interface OrderStatSummary {
  /** count per status; a status with no orders is absent from the response and reads as 0 here. */
  count: (status: OrderStatus) => number;
  /** Placed — nobody on the selling side has accepted these yet. */
  toConfirm: number;
  /** Confirmed, picking or packed — handed over, not yet gone. */
  inWarehouse: number;
  /** Shipped — out of the building. */
  shipped: number;
  orders30d: number;
  revenue30d: bigint;
  /** revenue ÷ orders, whole rupiah. 0 when there were no orders — never a division by zero. */
  avgOrder: bigint;
}

// The statuses that mean "the warehouse has this". CONFIRMED is in here deliberately: the selling side
// has finished with it and it is waiting on the crew, which is the same answer to "who is this
// sitting with" as picking and packed.
const IN_WAREHOUSE = [OrderStatus.CONFIRMED, OrderStatus.PICKING, OrderStatus.PACKED];

export function summariseOrderStat(res: OrderStatResponse | undefined): OrderStatSummary {
  const counts = new Map<OrderStatus, number>();

  for (const row of res?.byStatus ?? []) {
    counts.set(row.status, Number(row.count));
  }

  const count = (status: OrderStatus) => counts.get(status) ?? 0;

  const orders30d = Number(res?.preview?.orders30d ?? 0n);
  const revenue30d = res?.preview?.revenue30d ?? 0n;

  return {
    count,
    toConfirm: count(OrderStatus.PLACED),
    inWarehouse: IN_WAREHOUSE.reduce((sum, s) => sum + count(s), 0),
    shipped: count(OrderStatus.SHIPPED),
    orders30d,
    revenue30d,
    avgOrder: orders30d > 0 ? revenue30d / BigInt(orders30d) : 0n,
  };
}

// ── THE SUMMARY, BY STATUS ────────────────────────────────────────────────────────────────────────
//
// A second reading of the SAME census, for the strip the owner specified: the summary is by STATUS
// first — one row per status when nothing is filtered, and that one status's figures when something
// is. Both are this array; only the layout differs (see `features/orders/OrderSummary.tsx`).
//
// ⚠ EVERY FIGURE FOLLOWS THE FILTER BAR. `OrderStatFilter` carries the search, the shop and the date
// window, so the census is already narrowed to what the screen is showing. The 30-day preview above
// is the one figure that does NOT, which is why the strip that reads this does not show it: two
// windows on one screen get read as one.
//
// ⚠ A NULL IS "THE CONTRACT DOES NOT CARRY THIS", NOT ZERO. `OrderStatusCount` sums `total` and
// nothing else today — no goods value, no cost, no line count — so those four arrive as `null` and
// render as an em-dash rather than as a confident 0. A preview may fill them with sample figures; it
// then owes the reader a mark saying so.
export interface OrderSummaryRow {
  /**
   * What this row IS — a caller's own name for the pile, not a proto value.
   *
   * ⚠ The screen's vocabulary and the contract's are not the same set: the owner decided eight
   * statuses and `OrderStatus` carries six, differently named, one of which is three of the eight
   * rolled together. So a row is keyed by the caller's id and told which proto statuses to sum.
   */
  key: string;
  /**
   * Whether the contract can answer ANYTHING about this pile.
   *
   * ⚠ FALSE MAKES EVERY FIGURE UNKNOWN, INCLUDING THE COUNT. A group naming no proto status sums to
   * zero, and that zero is not a measurement — "no orders are completed" is a claim the contract
   * cannot make when it has no `completed` to count. Same rule as a cogs of 0, one level up.
   */
  onTheWire: boolean;
  /** How many orders are in this pile right now. */
  count: number;
  /** Σ `total` — what the buyers are paying, shipping included. */
  value: bigint;
  /**
   * Σ `marketplace_total` — WHAT THE BUYERS ACTUALLY PAID THE PLATFORM, and the top of the margin.
   *
   * ⚠ NOT Σ `total`. `value` above is our own quote; this is the figure after the marketplace's
   * vouchers and subsidies, and the owner's margin is measured against it
   * (`the-margin-is-mp-minus-total-beli`). It replaced Σ `subtotal`, which measured our quote against
   * our cost and never looked at what the platform paid.
   *
   * ⚠ OVER THE ORDERS THAT CARRY A COST, not over all of them, and `cogs` and `fees` cover the SAME
   * population. Summing every order's revenue against only the priced orders' cost inflates the
   * margin by the unpriced orders' whole sale — not a rounding error: one unpriced order among nine
   * moved a 36% margin to 48% the first time this was rendered.
   */
  mpValue: bigint | null;
  /** Σ `cogs`, over the same orders as `mpValue`. */
  cogs: bigint | null;
  /**
   * Σ of the per-order FULFILMENT FEES, over the same orders again — the `biaya` half of total beli.
   *
   * ⚠ IT BELONGS AT THE BOTTOM OF THE SUBTRACTION. Leaving it out was the first version of this and
   * it overstated every pile by the whole warehouse bill.
   */
  fees: bigint | null;
  /**
   * How many of `count` the margin CANNOT BE TAKEN OVER, so the reader knows what it left out.
   *
   * ⚠ IT IS NOT "no recorded cost" ANY MORE. The margin needs TWO facts — the cost and what the
   * marketplace paid — so an order is unmeasurable if EITHER is missing, and the two absences are
   * unrelated: fixture 107 has no cost, 108 has no marketplace figure. Counting only the cost left the
   * strip claiming 30% more margin than the rows beneath it summed to, which is the exact drift this
   * file exists to prevent.
   */
  marginUnknown: number | null;
  /** Σ line quantity — UNITS, not lines, because that is what UPT counts. */
  itemCount: number | null;
}

/** What a caller wants summed into one row. */
export interface OrderSummaryGroup {
  key: string;
  /**
   * The proto statuses to add up.
   *
   * ⚠ EMPTY IS LEGAL and means the contract has no status for this pile at all — the row is drawn,
   * reads zero, and the screen owes the reader a mark saying why it can never read anything else.
   */
  statuses: OrderStatus[];
}

/** An empty row for a pile nothing is sitting in — absent from the response reads as zero. */
function emptyRow(key: string, onTheWire: boolean): OrderSummaryRow {
  return {
    key,
    onTheWire,
    count: 0,
    value: 0n,
    mpValue: null,
    cogs: null,
    fees: null,
    marginUnknown: null,
    itemCount: null,
  };
}

/**
 * One row per GROUP, in the order given — the caller passes the tab order, so the strip and the tabs
 * read down the page in the same sequence.
 *
 * A status the response does not mention contributes nothing rather than being dropped: a gap in the
 * list would make the reader work out which piles are missing.
 */
export function orderSummaryRows(
  res: OrderStatResponse | undefined,
  groups: OrderSummaryGroup[],
): OrderSummaryRow[] {
  const census = new Map<OrderStatus, { count: number; value: bigint }>();

  for (const row of res?.byStatus ?? []) {
    census.set(row.status, { count: Number(row.count), value: row.value });
  }

  return groups.map((group) => {
    const row = emptyRow(group.key, group.statuses.length > 0);

    // ⚠ SUMMED, not looked up: one pile may cover several proto statuses (`processed` covers three),
    // which is the whole reason a group carries a list rather than a single value.
    for (const status of group.statuses) {
      const entry = census.get(status);

      if (entry) {
        row.count += entry.count;
        row.value += entry.value;
      }
    }

    return row;
  });
}

/**
 * The TOTAL row, summed from the rows the reader can also see — never a separate figure from the
 * server, which could disagree with the column above it the moment either definition moved.
 *
 * ⚠ A null column stays null unless EVERY row has it. Summing the rows that happen to carry a cost
 * while ignoring the ones that do not would produce a total that is short by an unknown amount and
 * says nothing about it.
 */
export function orderSummaryTotal(rows: OrderSummaryRow[]): OrderSummaryRow {
  // ⚠ A PILE THE CONTRACT CANNOT HOLD IS SKIPPED, not treated as a gap. It contributes nothing by
  // definition, so letting its nulls decide the total's nullability would blank every money column
  // the moment one of the owner's undelivered statuses appeared in the list — which is always.
  const counted = rows.filter((row) => row.onTheWire);

  const sumOrNull = (pick: (r: OrderSummaryRow) => bigint | null): bigint | null =>
    counted.every((r) => pick(r) !== null) ? counted.reduce((sum, r) => sum + pick(r)!, 0n) : null;

  const countOrNull = (pick: (r: OrderSummaryRow) => number | null): number | null =>
    counted.every((r) => pick(r) !== null) ? counted.reduce((sum, r) => sum + pick(r)!, 0) : null;

  return {
    key: "total",
    // The total is always measurable: the piles the contract cannot hold contribute nothing to it,
    // which is the right answer rather than a missing one.
    onTheWire: true,
    count: counted.reduce((sum, r) => sum + r.count, 0),
    value: counted.reduce((sum, r) => sum + r.value, 0n),
    mpValue: sumOrNull((r) => r.mpValue),
    cogs: sumOrNull((r) => r.cogs),
    fees: sumOrNull((r) => r.fees),
    marginUnknown: countOrNull((r) => r.marginUnknown),
    itemCount: countOrNull((r) => r.itemCount),
  };
}

// ── The derived figures ───────────────────────────────────────────────────────────────────────────
//
// Arithmetic over columns the reader can see, done here so every caller divides the same way. Each
// refuses rather than divides by zero — an empty status is an em-dash, never a 0% that reads as a
// measured result.

/** Average transaction value — Σ total ÷ orders, whole rupiah. */
export function summaryAtv(row: OrderSummaryRow): bigint | null {
  return row.onTheWire && row.count > 0 ? row.value / BigInt(row.count) : null;
}

/** Units per transaction. Kept as a float — the whole point is the fraction. */
export function summaryUpt(row: OrderSummaryRow): number | null {
  return row.onTheWire && row.itemCount !== null && row.count > 0
    ? row.itemCount / row.count
    : null;
}

/**
 * TOTAL BELI over the pile — Σ cost + Σ fees, or `null` when nothing here is priced.
 *
 * The owner's `subtotal produk + biaya`, summed. It is what the strip labels *nilai belanja*, so the
 * card and the table's `Beli` cell mean the same thing by the same word.
 */
export function summarySpend(row: OrderSummaryRow): bigint | null {
  if (row.cogs === null || row.fees === null) {
    return null;
  }

  return orderSpend(row.cogs, row.fees, summaryHasMeasured(row));
}

/**
 * GROSS MARGIN — what the platform paid, minus what the order cost us (owner, 2026-09-28).
 *
 * ⚠ `mpValue`, NEVER `value` and no longer Σ `subtotal`. `value` is our own quote; the margin is
 * measured against what the buyers actually paid the platform.
 *
 * ⚠ It is NOT profit, and must not be labelled as one. What the marketplace deducts beyond the price
 * only lands weeks later, on the settlement ledger.
 */
export function summaryMargin(row: OrderSummaryRow): bigint | null {
  if (row.mpValue === null) {
    return null;
  }

  // The arithmetic is `margin.ts`'s, shared with the table's per-order cell so the card and the row
  // beneath it cannot disagree. What stays here is the PILE's answer to "is this cost a measurement".
  return orderMargin(row.mpValue, summarySpend(row));
}

/**
 * Whether ANY order here can be measured at all — a cost AND a marketplace figure.
 *
 * ⚠ When none can, the money columns are 0 and that 0 is not a measurement, it is the absence of one.
 * Rendering it as `Rp 0` produced a status reading "margin 100%", which is the most confident wrong
 * number this screen could print. Everything derived is an em-dash instead.
 */
export function summaryHasMeasured(row: OrderSummaryRow): boolean {
  if (!row.onTheWire || row.count === 0) {
    return false;
  }

  return row.marginUnknown === null ? true : row.marginUnknown < row.count;
}

/** The margin as a share OF WHAT THE PLATFORM PAID. One decimal, computed in tenths. */
export function summaryMarginPct(row: OrderSummaryRow): number | null {
  if (row.mpValue === null) {
    return null;
  }

  return orderMarginPct(row.mpValue, summarySpend(row));
}
