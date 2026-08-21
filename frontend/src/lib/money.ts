// Money is stored as whole rupiah (int64 → bigint here). formatRupiah renders it with id-ID
// grouping, e.g. 25000n → "Rp 25.000".
export function formatRupiah(amount: bigint): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

// The Indonesian short-scale suffixes, largest first so the first match wins.
const COMPACT_UNITS: Array<{ limit: number; suffix: string }> = [
  { limit: 1e12, suffix: "T" }, // triliun
  { limit: 1e9, suffix: "M" }, // miliar
  { limit: 1e6, suffix: "jt" }, // juta
  { limit: 1e3, suffix: "rb" }, // ribu
];

/**
 * Money → a SHORT rupiah string: 1_500_000n → "Rp 1,5jt".
 *
 * A stock or invoice table puts a dozen money columns beside each other, and at full precision
 * "Rp 1.500.000" and "Rp 15.000.000" differ by one character in the middle — the reader has to
 * count digits to tell an order of magnitude apart. The compact form makes the magnitude the first
 * thing you read, which is what the eye is actually scanning that column for.
 *
 * ⚠ It LOSES PRECISION, so it is never the only rendering of a value a person acts on. `PriceText`
 * pairs it with the exact amount in a tooltip; a form field or a total being reconciled uses
 * {@link formatRupiah}.
 *
 * The decimal separator is a comma, matching id-ID grouping — "Rp 1,5jt", not "Rp 1.5jt".
 */
export function formatRupiahCompact(amount: bigint): string {
  const n = Number(amount);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  for (const { limit, suffix } of COMPACT_UNITS) {
    if (abs >= limit) {
      const scaled = abs / limit;
      // One decimal below 100, none above: "1,5jt" is useful, "150,3jt" is just noise at a glance.
      const text = scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, "") : scaled.toFixed(0);
      return `${sign}Rp ${text.replace(".", ",")}${suffix}`;
    }
  }

  return formatRupiah(amount);
}
