// ⚠ SAMPLE FIGURES — the restock list's statistics, until a read sums them. Nothing in the contract counts a team's
// restocks by status: the list pages its rows, and OwnerStockStat says only what is in flight. Every figure here is
// INVENTED, steady per team, and marked on screen (`pending.ts`, `summary`); it does not follow the filters.
//
// What a real read must return, per status and for them all, under the list's own filters: how many restocks, the
// units on their lines, the distinct products, the goods value, the courier's charge at the door, and the goods plus
// shipping — and, for the breakdown, the same total per paying account.

import type { FinancialAccount } from "../../gen/warehouse/financial_account/v1/financial_account_pb";

/** One pile of restocks — a status, or all of them. */
export interface RestockPile {
  /** The status tab's value — `all` for the total. */
  key: string;
  transactions: number;
  units: number;
  /** Distinct products across the pile's lines — not lines. */
  skus: number;
  /** The lines' totals. */
  goods: number;
  /** What the shipment cost the team — inside the transaction's value. */
  shipping: number;
  /** Ongkir COD: what the warehouse paid the courier at the door — outside the transaction's value. */
  courierCharge: number;
}

/** The transaction's value — goods plus shipping, never the courier's charge at the door. */
export const pileValue = (pile: RestockPile) => pile.goods + pile.shipping;

export interface RestockSummaryData {
  total: RestockPile;
  piles: RestockPile[];
}

// A small steady generator — the same team reads the same figures on every visit.
function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;

  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// How many of a team's restocks sit in each status, roughly — most are counted in, a few are on their way.
const SHAPE: { key: string; transactions: [number, number]; atTheDoor: boolean }[] = [
  { key: "ongoing", transactions: [2, 6], atTheDoor: false },
  { key: "arrived", transactions: [1, 3], atTheDoor: true },
  { key: "accepted", transactions: [18, 40], atTheDoor: true },
  { key: "lost", transactions: [0, 2], atTheDoor: false },
  { key: "cancelled", transactions: [1, 4], atTheDoor: false },
];

export function sampleRestockSummary(teamId: bigint): RestockSummaryData {
  const next = seeded(Number(teamId % 100_000n) * 7919 + 17);
  const between = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));

  const piles = SHAPE.map(({ key, transactions: [lo, hi], atTheDoor }) => {
    const transactions = between(lo, hi);
    const units = transactions * between(15, 45);
    const skus = transactions === 0 ? 0 : Math.min(units, between(transactions, transactions * 3));
    // Whole thousands, as a store's prices are.
    const goods = units * between(12, 38) * 1000;
    const shipping = transactions * between(15, 35) * 1000;
    // The courier asks at the door on some boxes only — and only a box that came to the door.
    const courierCharge = atTheDoor ? Math.floor(transactions / 3) * between(5, 12) * 1000 : 0;

    return { key, transactions, units, skus, goods, shipping, courierCharge };
  });

  const total = piles.reduce<RestockPile>(
    (sum, p) => ({
      key: "all",
      transactions: sum.transactions + p.transactions,
      units: sum.units + p.units,
      skus: Math.max(sum.skus, p.skus),
      goods: sum.goods + p.goods,
      shipping: sum.shipping + p.shipping,
      courierCharge: sum.courierCharge + p.courierCharge,
    }),
    { key: "all", transactions: 0, units: 0, skus: 0, goods: 0, shipping: 0, courierCharge: 0 },
  );

  return { total, piles };
}

/** One paying account's share of a pile's value. */
export interface PaymentShare {
  account: FinancialAccount;
  transactions: number;
  value: number;
}

// The share each of the first three accounts takes — the split is invented; the accounts are the team's real ones.
const SPLIT = [0.6, 0.3, 0.1];

/** A pile's value split over the team's operational accounts — the ones a restock is paid from. */
export function samplePaymentSplit(pile: RestockPile, accounts: FinancialAccount[]): PaymentShare[] {
  const used = accounts.slice(0, SPLIT.length);
  if (used.length === 0 || pile.transactions === 0) return [];

  const weights = SPLIT.slice(0, used.length);
  const sum = weights.reduce((a, b) => a + b, 0);
  const value = pileValue(pile);
  let txLeft = pile.transactions;
  let valueLeft = value;

  return used
    .map((account, i) => {
      const last = i === used.length - 1;
      const share = weights[i]! / sum;
      const transactions = last ? txLeft : Math.min(txLeft, Math.max(1, Math.round(pile.transactions * share)));
      const part = last ? valueLeft : Math.round((value * share) / 1000) * 1000;
      txLeft -= transactions;
      valueLeft -= part;

      return { account, transactions, value: part };
    })
    .filter((row) => row.transactions > 0);
}
