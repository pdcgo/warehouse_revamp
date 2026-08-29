import type { OrderSettlement, SettlementEntry } from "./model";

// The data the prototype is reviewed against.
//
// ⚠ `worked` IS THE OWNER'S OWN EXAMPLE, transcribed row for row from `context.md` §Settlement
// Behaviors. It is first on purpose: the first thing to check about the screen is whether the table
// in the requirement doc, rendered, still says what it said in the doc.
//
// The others exist because every one of them is a case the design makes a CLAIM about, and a claim
// with no picture beside it is a claim nobody reviewed.

/** Chain a list of changes into running balances, so a fixture cannot drift from its own arithmetic. */
function chain(
  rows: Array<Omit<SettlementEntry, "balance" | "id"> & { id?: string }>,
): SettlementEntry[] {
  let running = 0n;
  return rows.map((row, i) => {
    running += row.change;
    return { ...row, id: row.id ?? `e${i + 1}`, balance: running };
  });
}

// ── The owner's worked example ──────────────────────────────────────────────────────────────────

const workedEntries = chain([
  {
    uniqueId: "sys:order:1",
    settlementType: "initial_total",
    change: -120_000n,
    sourceType: "exporter",
    actorName: "Ani",
    occurredOn: "2026-01-01",
    postedOn: "2026-01-01",
    note: "On Order Created",
  },
  {
    uniqueId: "shopee:2026-01-02:payout:1",
    settlementType: "fund",
    change: 100_000n,
    sourceType: "exporter",
    actorName: "Ani",
    occurredOn: "2026-01-02",
    postedOn: "2026-01-02",
    note: "On Order Completed",
  },
  {
    uniqueId: "shopee:2026-01-04:ads:1",
    settlementType: "external_ads_fee",
    change: -10_000n,
    sourceType: "exporter",
    actorName: "Ani",
    occurredOn: "2026-01-04",
    postedOn: "2026-01-04",
    note: "Ads Fee External Platform",
  },
  {
    uniqueId: "shopee:2026-01-04:adj:1",
    settlementType: "marketplace_adjustment",
    change: 20_000n,
    sourceType: "exporter",
    actorName: "Ani",
    occurredOn: "2026-01-04",
    postedOn: "2026-01-04",
    note: "reimbursement",
  },
]);

/**
 * §Settlement Behaviors, exactly. Ends at −10.000, and the owner's reading of that is the design's:
 * *"yes actually our order lossing that"*.
 *
 * The breakdown the panel shows: estimate 120.000, funded 100.000, so **20.000 was kept and never
 * itemised**; named rows gave 10.000 back; the order lost 10.000.
 */
export const worked: OrderSettlement = {
  orderId: 1n,
  orderRef: "250101ABCDE",
  shopName: "Toko Sinar",
  teamName: "Selling A",
  initialTotal: 120_000n,
  lastBalance: -10_000n,
  cogs: 70_000n,
  entries: workedEntries,
};

// ── The cases the design makes a claim about ────────────────────────────────────────────────────

/**
 * NOTHING HAS ARRIVED YET — the account holds only its estimate.
 *
 * This is what every order looks like the moment it is placed, and it is the state
 * `settlement-ignores-our-order-status` allows to persist indefinitely: nothing is waiting on a
 * status of ours, so an order can sit here for a week without anything being wrong.
 */
export const awaiting: OrderSettlement = {
  orderId: 2n,
  orderRef: "250103FGHIJ",
  shopName: "Toko Sinar",
  teamName: "Selling A",
  initialTotal: 85_000n,
  lastBalance: -85_000n,
  cogs: 52_000n,
  entries: chain([
    {
      uniqueId: "sys:order:2",
      settlementType: "initial_total",
      change: -85_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-03",
      postedOn: "2026-01-03",
    },
  ]),
};

/**
 * A LATE FEE — posted six days after the day it belongs to.
 *
 * `§3` — *"its also still happen other fee in next day"*. The row is the argument for
 * `two-dates-occurred-and-posted`: with one date column this charge would either land in a closed
 * month or silently move to the wrong one, and the screen could not show that it arrived late.
 */
export const lateFee: OrderSettlement = {
  orderId: 3n,
  orderRef: "241230KLMNO",
  shopName: "Toko Sinar",
  teamName: "Selling A",
  initialTotal: 240_000n,
  lastBalance: -31_000n,
  cogs: 150_000n,
  entries: chain([
    {
      uniqueId: "sys:order:3",
      settlementType: "initial_total",
      change: -240_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2025-12-30",
      postedOn: "2025-12-30",
    },
    {
      uniqueId: "shopee:2025-12-31:payout:3",
      settlementType: "fund",
      change: 215_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2025-12-31",
      postedOn: "2025-12-31",
    },
    {
      uniqueId: "shopee:2025-12-31:aff:3",
      settlementType: "affiliate_fee",
      change: -6_000n,
      sourceType: "exporter",
      actorName: "Ani",
      // Belongs to December. Learned in January — this is the gap the two dates exist to show.
      occurredOn: "2025-12-31",
      postedOn: "2026-01-06",
    },
  ]),
};

/**
 * A MANUAL ENTRY AND ITS REVERSAL — the whole append-only story in four rows.
 *
 * Someone typed 45.000 where they meant 4.500, and under
 * `a-correction-is-a-new-row` the fix is a fifth row, not an edit and not a delete. Both stay on
 * screen forever, which is the point: the ledger is evidence, and evidence you can tidy is not
 * evidence.
 */
export const correctedByHand: OrderSettlement = {
  orderId: 4n,
  orderRef: "250105PQRST",
  shopName: "Toko Melati",
  teamName: "Selling A",
  initialTotal: 310_000n,
  lastBalance: -21_500n,
  cogs: 195_000n,
  entries: chain([
    {
      uniqueId: "sys:order:4",
      settlementType: "initial_total",
      change: -310_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-05",
      postedOn: "2026-01-05",
    },
    {
      uniqueId: "shopee:2026-01-07:payout:4",
      settlementType: "fund",
      change: 284_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-07",
      postedOn: "2026-01-07",
    },
    {
      id: "typo",
      uniqueId: "manual:budi:1736251200000",
      settlementType: "marketplace_adjustment",
      change: -45_000n,
      sourceType: "manual",
      actorName: "Budi",
      occurredOn: "2026-01-08",
      postedOn: "2026-01-08",
      note: "voucher clawback",
    },
    {
      uniqueId: "manual:budi:1736254800000",
      settlementType: "marketplace_adjustment",
      change: 45_000n,
      sourceType: "manual",
      actorName: "Budi",
      occurredOn: "2026-01-08",
      postedOn: "2026-01-08",
      reversesId: "typo",
      note: "reverse — wrong amount",
    },
    {
      uniqueId: "manual:budi:1736258400000",
      settlementType: "marketplace_adjustment",
      change: -4_500n,
      sourceType: "manual",
      actorName: "Budi",
      occurredOn: "2026-01-08",
      postedOn: "2026-01-08",
      note: "voucher clawback",
    },
  ]),
};

/**
 * AN ORDER THAT CAME OUT AHEAD — a positive balance.
 *
 * Rare and real: a reimbursement larger than what was withheld. It is here because the screen must
 * not assume the number is always a loss — a red-only design would render this as a smaller loss,
 * which is a lie in the one direction nobody checks.
 */
export const ahead: OrderSettlement = {
  orderId: 5n,
  orderRef: "250104UVWXY",
  shopName: "Toko Melati",
  teamName: "Selling A",
  initialTotal: 96_000n,
  lastBalance: 4_000n,
  cogs: 61_000n,
  entries: chain([
    {
      uniqueId: "sys:order:5",
      settlementType: "initial_total",
      change: -96_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-04",
      postedOn: "2026-01-04",
    },
    {
      uniqueId: "shopee:2026-01-06:payout:5",
      settlementType: "fund",
      change: 88_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-06",
      postedOn: "2026-01-06",
    },
    {
      uniqueId: "shopee:2026-01-09:adj:5",
      settlementType: "marketplace_adjustment",
      change: 12_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-09",
      postedOn: "2026-01-09",
      note: "lost parcel compensation",
    },
  ]),
};

/**
 * NO ESTIMATE AT ALL — `marketplace_total` was 0 because nobody recorded one.
 *
 * ⚠ THE OPEN QUESTION, ON SCREEN. `order.proto:224` says 0 means *not recorded*, not "worth
 * nothing" — an order taken over the phone has no marketplace figure. Rendered naively this order
 * reads as **pure profit**, because every rupiah that arrives is a gain against an estimate of zero.
 *
 * The screen refuses to compute rather than printing a number it cannot stand behind. It is the
 * cheapest possible argument for giving `marketplace_total = 0` a rule.
 */
export const noEstimate: OrderSettlement = {
  orderId: 6n,
  orderRef: "",
  shopName: "Toko Melati",
  teamName: "Selling A",
  initialTotal: 0n,
  lastBalance: 62_000n,
  cogs: 40_000n,
  entries: chain([
    {
      uniqueId: "shopee:2026-01-08:payout:6",
      settlementType: "fund",
      change: 62_000n,
      sourceType: "exporter",
      actorName: "Ani",
      occurredOn: "2026-01-08",
      postedOn: "2026-01-08",
    },
  ]),
};

/** Every fixture, in the order the list screen would show them — worst loss first. */
export const allOrders: OrderSettlement[] = [
  awaiting,
  lateFee,
  correctedByHand,
  worked,
  ahead,
  noEstimate,
];
