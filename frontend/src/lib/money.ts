// Money is stored as whole rupiah (int64 → bigint here). formatRupiah renders it with id-ID
// grouping, e.g. 25000n → "Rp 25.000".
//
// ⚠ A NEGATIVE AMOUNT PUTS ITS MINUS BEFORE "Rp" — "−Rp 10.000", never "Rp -10.000" (owner:
// `a-negative-amount-puts-its-minus-before-rp`). The sign is what says which way the money went, and
// buried after the currency it was the one character nobody read. The minus is the typographic "−", the
// same one a signed change already shows, so a change and the balance beside it read alike.
export function formatRupiah(amount: bigint): string {
  if (amount < 0n) return `−Rp ${(-amount).toLocaleString("id-ID")}`;
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

// formatSignedRupiah writes BOTH signs — "+Rp 4.000", "−Rp 10.000", "Rp 0" — for an amount whose
// direction is the point (a change, a running balance, a settlement adjustment). formatRupiah writes the
// minus the same way and leaves a positive amount bare.
export function formatSignedRupiah(amount: bigint): string {
  if (amount === 0n) return formatRupiah(0n);
  return `${amount > 0n ? "+" : "−"}${formatRupiah(amount > 0n ? amount : -amount)}`;
}

// formatRupiahNumber is formatRupiah for a `double` amount — the wire type rupiah-is-floating-point
// decided, which the newer contracts carry. Rounded to whole rupiah for display: a fraction of a rupiah
// is not money anyone can hand over, and the server rounds as a row posts anyway.
export function formatRupiahNumber(amount: number): string {
  return formatRupiah(BigInt(Math.round(amount)));
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
  // The same minus, in the same place, as formatRupiah.
  const sign = n < 0 ? "−" : "";

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
