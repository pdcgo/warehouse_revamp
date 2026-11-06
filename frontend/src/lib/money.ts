// Every money field on the wire is a `double` since the ledgers moved (every-ledger-moves-to-double-rounded-when-frozen,
// numeric-money-moves-to-double-too), so a contract gives a number — the EXACT figure the server stored, never rounded
// (the-backend-never-rounds-money). A bigint is still a `Rupiah` (an old fixture, a whole figure typed as one), and the
// formatters take EITHER, writing both alike. Money arithmetic is done on numbers, exactly as the server does it, and
// only the formatters below round — for the screen.
// formatRupiah renders it with id-ID grouping, e.g. 25000n or 25000 → "Rp 25.000".
//
// A FIGURE WITH A FRACTION SHOWS UP TO 3 DECIMALS (owner: `a-fraction-of-a-rupiah-shows-three-decimals`). A whole
// figure reads as today; one with a fraction — a unit cost with markup, a percentage fee, a goods cost drawn at FIFO
// prices — shows its fraction in the Indonesian form, "Rp 12.345,505", rounded half away from zero to 3 places with the
// trailing zeros dropped ("Rp 12.345,5"). The rounding is for DISPLAY ONLY: nothing here feeds a sum. A bigint is
// whole by construction.
//
// ⚠ A NEGATIVE AMOUNT PUTS ITS MINUS BEFORE "Rp" — "−Rp 10.000", never "Rp -10.000" (owner:
// `a-negative-amount-puts-its-minus-before-rp`). The sign is what says which way the money went, and
// buried after the currency it was the one character nobody read. The minus is the typographic "−", the
// same one a signed change already shows, so a change and the balance beside it read alike.
export type Rupiah = bigint | number;

// rupiahNumber is a Rupiah as the number the server computes with — a bigint widened (exact for every figure below
// 2^53), a number as it is, never rounded (the-backend-never-rounds-money). A NaN or an infinity reads as 0, so a
// screen never computes on one.
export function rupiahNumber(amount: Rupiah): number {
  const n = typeof amount === "bigint" ? Number(amount) : amount;
  return Number.isFinite(n) ? n : 0;
}

// The places two amounts are compared at — the server's san_money.Places (stock-money-is-float64-compared-at-4-digits).
const COMPARE_SCALE = 10_000;

// isZeroRupiah is the server's san_money.IsZero: zero to 4 places, so float dust from summing exact fractions never
// reads as a debt, a direction or a limit. A comparison only — the amount itself is never rounded.
export function isZeroRupiah(amount: Rupiah): boolean {
  return Math.round(Math.abs(rupiahNumber(amount)) * COMPARE_SCALE) === 0;
}

// signOfRupiah is −1, 0 or 1 — 0 for an amount that is zero to 4 places (isZeroRupiah).
export function signOfRupiah(amount: Rupiah): -1 | 0 | 1 {
  if (isZeroRupiah(amount)) return 0;
  return rupiahNumber(amount) < 0 ? -1 : 1;
}

// The places a fraction of a rupiah is shown to (a-fraction-of-a-rupiah-shows-three-decimals).
const DISPLAY_PLACES = 3;
const DISPLAY_SCALE = 10 ** DISPLAY_PLACES;
// Past this a double holds no thousandth of a rupiah anyway; the figure is shown whole.
const FRACTION_LIMIT = 1e12;

// displayParts splits an amount into what the screen writes: its sign, its whole rupiah and its fraction digits ("" for
// a whole figure) — rounded half away from zero to DISPLAY_PLACES. A NaN or an infinity reads as 0, and a figure that
// rounds to nothing is never negative, so "−Rp 0" cannot be written.
function displayParts(amount: Rupiah): { negative: boolean; whole: bigint; fraction: string } {
  if (typeof amount === "bigint") {
    return { negative: amount < 0n, whole: amount < 0n ? -amount : amount, fraction: "" };
  }
  if (!Number.isFinite(amount)) return { negative: false, whole: 0n, fraction: "" };

  const abs = Math.abs(amount);
  if (abs >= FRACTION_LIMIT) {
    const whole = BigInt(Math.round(abs));
    return { negative: amount < 0 && whole > 0n, whole, fraction: "" };
  }

  // toPrecision(15) clears binary dust before rounding (1,0005 is stored as 1,000499…; × 1000 must still read 1000,5).
  const milli = Math.round(Number((abs * DISPLAY_SCALE).toPrecision(15)));
  const whole = BigInt(Math.floor(milli / DISPLAY_SCALE));
  const fraction = String(milli % DISPLAY_SCALE)
    .padStart(DISPLAY_PLACES, "0")
    .replace(/0+$/, "");

  return { negative: amount < 0 && (whole > 0n || fraction !== ""), whole, fraction };
}

export function formatRupiah(amount: Rupiah): string {
  const { negative, whole, fraction } = displayParts(amount);
  const text = `Rp ${whole.toLocaleString("id-ID")}${fraction === "" ? "" : `,${fraction}`}`;
  return negative ? `−${text}` : text;
}

// formatRupiahRange writes a price range on ONE line — "Rp 45.700 – Rp 47.200" — or one price when both ends agree, since
// "Rp 5.000 – Rp 5.000" is noise (`a-cost-range-reads-as-a-range`). The product list, the product's page and Discover
// write a cost range, and its cross price, with this one function.
export function formatRupiahRange(min: Rupiah, max: Rupiah): string {
  // The same TEXT is the same price: two costs a thousandth apart read as one.
  const low = formatRupiah(min);
  const high = formatRupiah(max);
  return low === high ? low : `${low} – ${high}`;
}

// formatSignedRupiah writes BOTH signs — "+Rp 4.000", "−Rp 10.000", "Rp 0" — for an amount whose
// direction is the point (a change, a running balance, a settlement adjustment). formatRupiah writes the
// minus the same way and leaves a positive amount bare.
export function formatSignedRupiah(amount: Rupiah): string {
  const text = formatRupiah(amount);
  if (text === formatRupiah(0n)) return text;
  return text.startsWith("−") ? text : `+${text}`;
}

// formatRupiahNumber is formatRupiah for a `double` amount — the wire type rupiah-is-floating-point
// decided, which the newer contracts carry. A fraction shows to 3 places, as formatRupiah writes it.
export function formatRupiahNumber(amount: number): string {
  return formatRupiah(amount);
}

// formatRupiahBare is formatRupiahNumber without its "Rp" — "10.750.000", "−150.000" — for a table that says the
// currency ONCE, over its columns, instead of on every figure (owner: `the-rincian-says-rp-once`). The minus stays in
// front, the same "−".
export function formatRupiahBare(amount: number): string {
  return formatRupiahNumber(amount).replace("Rp ", "");
}

// The Indonesian short-scale suffixes, largest first so the first match wins.
const COMPACT_UNITS: Array<{ limit: number; suffix: string }> = [
  { limit: 1e12, suffix: "T" }, // triliun
  { limit: 1e9, suffix: "M" }, // miliar
  { limit: 1e6, suffix: "jt" }, // juta
  { limit: 1e3, suffix: "rb" }, // ribu
];

/**
 * Money → a SHORT rupiah string: 1_500_000n (or 1_500_000) → "Rp 1,5jt".
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
 *
 * A FRACTION OF A RUPIAH (a-fraction-of-a-rupiah-shows-three-decimals): from Rp 1rb up the compact form keeps its own
 * one scaled decimal — "Rp 12,3rb" already drops the rupiah, so a thousandth of one is noise there. Below Rp 1rb there
 * is nothing to compact, and the figure reads as formatRupiah writes it, fraction included ("Rp 512,75").
 */
export function formatRupiahCompact(amount: Rupiah): string {
  const n = typeof amount === "bigint" ? Number(amount) : Number.isFinite(amount) ? amount : 0;
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
