// ⚠ SAMPLE FIGURE — the COD this warehouse paid couriers at the door this month, until a read sums it. Each restock
// stores the courier's charge (`warehouse_additional_cost`, entered at accept — the-warehouse-cost-is-the-couriers-
// charge-at-the-door), but nothing totals it. INVENTED, steady per warehouse, and marked on screen (`pending.ts`, `cod`).
//
// What a real read must return, for the restocks this warehouse accepted in a window: how many carried a courier's
// charge, and the sum of those charges.

export interface CodSample {
  /** Restocks accepted this month that carried a courier's charge. */
  restocks: number;
  /** The charges' sum, rupiah. */
  amount: number;
}

// A small steady generator — the same warehouse reads the same figure on every visit.
export function sampleCodPaid(teamId: bigint): CodSample {
  const seed = Number(teamId % 997n) + 7;
  const restocks = 3 + (seed % 9);
  // Rp 15.000 – Rp 45.000 a box, rounded to the thousand.
  const amount = Array.from({ length: restocks }, (_, i) => 15_000 + (((seed * 31 + i * 17) % 31) * 1_000)).reduce(
    (sum, n) => sum + n,
    0,
  );

  return { restocks, amount };
}
