// A supplier's figures — `supplier_product_daily_reports` as supplier_service folds them from Restock Accepted
// (the-report-is-processed-like-settlement). Small enough to add up by hand: the stories assert on the arithmetic
// written beside each row, never on the stub's own sums.
//
// Dated RELATIVE TO TODAY so the screens' default window — the last 30 days — always holds the same rows. Ids follow
// supplierFixtures.ts (suppliers 3x) and fixtures.ts (products 7x, teams 1x).
//
//   PT Sumber Makmur (31, Toko Melati's)   — bought by Toko Melati (Beras 74) and Toko Kenanga (Gula 73)
//   UD Makmur Jaya   (34, Toko Kenanga's)  — the biggest seller of the window
//   PT Tekstil Nusantara (36, Anggrek's)   — another team's supplier Toko Melati buys from
//   Linen House      (37, Anggrek's)       — 5 units: under the 50-unit minimum, 40% broken
//   CV Lama Tutup    (38, DELETED)         — its figures are kept (a-deleted-supplier-is-kept-for-its-figures)

export interface FigureFixture {
  daysAgo: number;
  supplierId: bigint;
  productId: bigint;
  /** The RESTOCKING team. */
  teamId: bigint;
  restockCount: bigint;
  restockValuation: bigint;
  shippingLostCount: bigint;
  shippingLostValuation: bigint;
  shippingBrokenCount: bigint;
  shippingBrokenValuation: bigint;
}

const row = (
  daysAgo: number,
  supplierId: bigint,
  productId: bigint,
  teamId: bigint,
  [rc, rv]: [number, number],
  [lc, lv]: [number, number],
  [bc, bv]: [number, number],
): FigureFixture => ({
  daysAgo,
  supplierId,
  productId,
  teamId,
  restockCount: BigInt(rc),
  restockValuation: BigInt(rv),
  shippingLostCount: BigInt(lc),
  shippingLostValuation: BigInt(lv),
  shippingBrokenCount: BigInt(bc),
  shippingBrokenValuation: BigInt(bv),
});

export const figureFixtures: FigureFixture[] = [
  // PT Sumber Makmur — in the window: 70 good Beras (Rp 3.500.000) + 60 good Gula (Rp 900.000); 1 short, 6 broken.
  row(2, 31n, 74n, 12n, [40, 2_000_000], [1, 50_000], [2, 100_000]),
  row(5, 31n, 73n, 13n, [60, 900_000], [0, 0], [3, 45_000]),
  row(12, 31n, 74n, 12n, [30, 1_500_000], [0, 0], [1, 50_000]),
  // …and one OUTSIDE the last 30 days, which no default window may count.
  row(40, 31n, 74n, 12n, [10, 500_000], [0, 0], [0, 0]),

  // UD Makmur Jaya — 212 units, 10 broken: 4,7%.
  row(3, 34n, 73n, 13n, [200, 3_000_000], [2, 30_000], [10, 150_000]),

  // PT Tekstil Nusantara — Toko Melati buys from Anggrek's supplier. 25 units, none broken — under the minimum.
  row(7, 36n, 74n, 12n, [25, 1_250_000], [0, 0], [0, 0]),

  // Linen House — 5 units, 2 broken: 40%, and under the 50-unit minimum. Product 999 is in no catalogue the stub
  // knows, so it reads "Product #999".
  row(8, 37n, 999n, 15n, [3, 30_000], [0, 0], [2, 20_000]),

  // CV Lama Tutup — deleted; ranked with its figures kept, and opens nothing.
  row(10, 38n, 74n, 12n, [20, 1_000_000], [0, 0], [0, 0]),
];

/** `yyyy-mm-dd`, `n` LOCAL days ago — the calendar the screens' window is built on (features/settlement/window.ts). */
export function dayAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
