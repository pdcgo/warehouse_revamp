// THE WITHDRAWAL & PENYESUAIAN ROWS — invented whole, because nothing in the system holds them
// (owner: *"isinya data withdrawal, tgl (import & wd dari mp), sumber, nilai, negara lain dan
// deskripsi, mungkin sekarang jadi settlement itu, jadi aku masih bingung di sini"*).
//
// ⚠ THE OWNER IS UNDECIDED AND THE SCREEN SAYS SO. This renders the shape they described so it can be
// looked at and argued with — not because the design is settled.
//
// ⚠ WHY IT IS NOT SIMPLY "THE SETTLEMENT LEDGER". Settlement already exists and already hangs off an
// order, so the resemblance is real, but the two differ on the one thing that decides where a row
// lives:
//
//   settlement  every entry NAMES AN ORDER — it is what the platform paid or deducted for THIS sale
//   withdrawal  a WALLET → BANK movement — a shop-level cash event that names no order at all
//
// A withdrawal listed under an order is therefore either a different record that happens to be shown
// here, or the owner means the settlement entries and calls them by the old system's word. Those lead
// to different tables, so it is a question rather than a guess.
//
// ⚠ TWO DATES, AND THEY ARE NOT THE SAME EVENT. `importedAt` is when WE read the row off a sheet;
// `withdrawnAt` is when the marketplace moved the money. The gap between them is the whole reason a
// reconciliation is hard, so a mock with one date would hide the problem.
//
// ⚠ DELETE THIS FILE the day the section has a source. Every row is a lie with an end date.

export interface WithdrawalRow {
  id: string;
  /** When we read it off the marketplace's export. */
  importedAt: bigint;
  /** When the platform actually moved the money. Earlier than the import, always. */
  withdrawnAt: bigint;
  /** Where it came from — the owner's *sumber*. */
  source: string;
  /** Whole rupiah. Negative is money going the other way, which is what *penyesuaian* usually is. */
  amount: bigint;
  /** The owner's *negara lain* — a foreign-currency leg, blank on a domestic row. */
  foreign: string;
  description: string;
}

/**
 * Rows for one order, derived from its id so they never move between renders.
 *
 * ⚠ THE SET IS DELIBERATELY MIXED: a plain withdrawal, a NEGATIVE adjustment, and a foreign-currency
 * leg. One row of each is the minimum that proves the column set works — a table of three identical
 * positive rupiah rows would hide the sign, the currency column and the description all at once.
 */
export function mockWithdrawals(
  orderId: bigint,
  createdAt: bigint,
  marketplaceTotal: bigint,
): WithdrawalRow[] {
  const n = Number(orderId);

  // No rows at all for roughly a third of orders, because that is the ordinary state: the money has
  // not been released yet. A section that always had rows would never show its own empty case.
  if (n % 3 === 0) {
    return [];
  }

  const day = 86_400n;

  // ⚠ SCALED TO WHAT THE PLATFORM PAID, not fixed amounts. Fixed figures made the rows add up to MORE
  // than the order's marketplace total (102,8% on order 101) — money arriving that the buyer never paid.
  // A marketplace keeps its fees, so what reaches the wallet is a little LESS than the total: here the
  // domestic payout is 72%, the foreign leg 20%, and an adjustment takes 3% back — about 89% net.
  const base = marketplaceTotal > 0n ? marketplaceTotal : 200_000n;
  const share = (pct: bigint) => (base * pct) / 100n;

  return [
    {
      id: `${n}-1`,
      withdrawnAt: createdAt + 4n * day,
      importedAt: createdAt + 6n * day,
      source: "Shopee Wallet",
      amount: share(72n),
      foreign: "",
      description: "Pencairan saldo mingguan",
    },
    {
      id: `${n}-2`,
      withdrawnAt: createdAt + 9n * day,
      importedAt: createdAt + 11n * day,
      source: "Penyesuaian",
      // ⚠ NEGATIVE ON PURPOSE. An adjustment is usually money going back, and a table that only ever
      // showed positives would not reveal how it renders one.
      amount: -share(3n),
      foreign: "",
      description: "Koreksi ongkir yang ditanggung penjual",
    },
    {
      id: `${n}-3`,
      withdrawnAt: createdAt + 12n * day,
      importedAt: createdAt + 15n * day,
      source: "Shopee International",
      amount: share(20n),
      foreign: "SGD 5,40",
      description: "Penjualan lintas negara",
    },
  ];
}
