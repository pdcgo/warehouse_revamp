import type { RestockSellingStatResponse } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RESTOCK_STATUS_TABS } from "./statusTabs";

// THE SELLING RESTOCK LIST'S STATISTICS as the screen reads them (the-restock-statistics-count-transactions-under-the-tabs)
// — RestockSellingStat's answer, shaped into the piles the cards draw: the total, then one pile per status in the tabs'
// order, a status with no restock read as a zero pile (the server leaves it out, the OrderStat convention).

/** One pile of restocks — a status, or all of them. */
export interface RestockPile {
  /** The status tab's value — `all` for the total. */
  key: string;
  transactions: number;
  /** Jumlah barang: the pieces ORDERED on the lines, on every status (jumlah-barang-counts-the-pieces-ordered). */
  units: number;
  /** Distinct products across the pile's lines — not lines. The total's is the server's, over every status at once. */
  skus: number;
  /** The lines' totals. */
  goods: number;
  /** What the shipment cost the team — inside the transaction's value. */
  shipping: number;
  /** Ongkir COD: what the warehouse paid the courier at the door — outside the transaction's value. */
  courierCharge: number;
  /** Nilai transaksi — goods plus shipping, never the courier's charge at the door (the-couriers-charge-stays-out-of-total). */
  value: number;
}

/** One paying account's share of a pile (a-restock-names-its-paying-account). 0 = no account named on those restocks. */
export interface PaymentShare {
  accountId: bigint;
  transactions: number;
  value: number;
}

export interface RestockSummaryData {
  total: RestockPile;
  piles: RestockPile[];
  /** Rincian's rows per pile key — the restocks of that status paid from each account; they add up to its pile. */
  payments: Record<string, PaymentShare[]>;
}

const emptyPile = (key: string): RestockPile => ({
  key,
  transactions: 0,
  units: 0,
  skus: 0,
  goods: 0,
  shipping: 0,
  courierCharge: 0,
  value: 0,
});

type WirePile = NonNullable<RestockSellingStatResponse["total"]>;

const pileOf = (key: string, p: WirePile | undefined): RestockPile =>
  p
    ? {
        key,
        transactions: Number(p.restockCount),
        units: Number(p.unitCount),
        skus: Number(p.productCount),
        goods: p.goodsValue,
        shipping: p.shipmentCost,
        courierCharge: p.courierCharge,
        value: p.value,
      }
    : emptyPile(key);

/** The answer as the cards read it — the total, every status in the tabs' order, and Rincian's rows per status. */
export function restockSummaryOf(res: RestockSellingStatResponse): RestockSummaryData {
  const statuses = RESTOCK_STATUS_TABS.filter((tab) => tab.value !== "all");
  const piles = statuses.map((tab) => pileOf(tab.value, res.byStatus.find((p) => p.status === tab.status)));

  const payments: Record<string, PaymentShare[]> = {};
  for (const tab of statuses) {
    payments[tab.value] = res.byAccount
      .filter((a) => a.status === tab.status)
      .map((a) => ({ accountId: a.financeAccountId, transactions: Number(a.restockCount), value: a.value }))
      // The largest first — the account most of the money went through leads; no account named goes last.
      .sort((a, b) => (a.accountId === 0n ? 1 : 0) - (b.accountId === 0n ? 1 : 0) || b.value - a.value);
  }

  return { total: pileOf("all", res.total), piles, payments };
}
