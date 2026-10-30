import { formatRupiahCompact } from "../../lib/money";
import { oneOfCodec } from "../../lib/urlState";

// THE STOCK AND PRICE RANGES — picked, not typed (owner: *"untuk stok dan price rangenya pilih saja, kalau mau custom kudu
// klik tombol dulu … stok sekarang maksimal 100k, price maks 1jt, rangenya ada yang sedikit, ada yang panjang, aku
// serahkan padamu"*, `discover-ranges-are-picked`).
//
// NARROW WHERE THE NUMBERS ARE SMALL, WIDE WHERE THEY ARE LARGE — a seller tells 5 pcs from 40 pcs, but not 40.000 from
// 60.000; a price of Rp 12.000 is a different product from Rp 30.000, one of Rp 600.000 hardly from Rp 800.000. Every band
// is inclusive at both ends, and the last one ends at the ceiling.

/** One band — `min` and `max` both inclusive. */
export interface Band {
  key: string;
  min: number;
  max: number;
}

const band = (min: number, max: number): Band => ({ key: `${min}-${max}`, min, max });

/** The ready stock's ceiling — no warehouse holds more of one product than this. */
export const STOCK_MAX = 100_000;
/** The cross price's ceiling. */
export const PRICE_MAX = 1_000_000;

/**
 * READY stock, pcs: Kosong (0) · 1–10 · 11–50 · 51–100 · 101–500 · 501–1.000 · 1.001–10.000 · 10.001–100.000. KOSONG
 * FIRST (owner: *"ada juga filter stok kosong"*) — the products with nothing ready, a band of its own rather than a
 * custom 0–0.
 */
export const STOCK_BANDS: Band[] = [
  band(0, 0),
  band(1, 10),
  band(11, 50),
  band(51, 100),
  band(101, 500),
  band(501, 1_000),
  band(1_001, 10_000),
  band(10_001, STOCK_MAX),
];

/** The CROSS price, rupiah: ≤ 10rb · 10rb–25rb · 25rb–50rb · 50rb–100rb · 100rb–250rb · 250rb–500rb · 500rb–1jt. */
export const PRICE_BANDS: Band[] = [
  band(0, 10_000),
  band(10_000, 25_000),
  band(25_000, 50_000),
  band(50_000, 100_000),
  band(100_000, 250_000),
  band(250_000, 500_000),
  band(500_000, PRICE_MAX),
];

const pcs = (n: number) => n.toLocaleString("id-ID");

/** A stock band as its pill reads: `1–10`, `10.001–100.000` — and the empty one in words, which the caller supplies. */
export function stockBandLabel(b: Band, emptyLabel: string): string {
  return b.max === 0 ? emptyLabel : `${pcs(b.min)}–${pcs(b.max)}`;
}

/** An amount in the short scale without its "Rp" — "10rb", "1,5jt" — split into the number and its unit. */
function shortScale(n: number): { num: string; unit: string } {
  const text = formatRupiahCompact(BigInt(n)).replace(/^Rp /, "");
  const m = /^([\d.,]+)(\D*)$/.exec(text);
  return m ? { num: m[1]!, unit: m[2]! } : { num: text, unit: "" };
}

/**
 * A price band as its pill reads (owner: *"contoh 100rb-250rb jadi 100-250rb"*): `≤ 10rb`, `10–25rb`, `100–250rb` — the
 * unit ONCE, at the end, when both ends share it; both units where they differ, `500rb–1jt`. No "Rp": the group's label
 * (Harga cross) already says it is money, and on every pill it was the same three characters read nine times.
 */
export function priceBandLabel(b: Band): string {
  const max = shortScale(b.max);
  if (b.min === 0) return `≤ ${max.num}${max.unit}`;
  const min = shortScale(b.min);
  return min.unit === max.unit ? `${min.num}–${max.num}${max.unit}` : `${min.num}${min.unit}–${max.num}${max.unit}`;
}

/**
 * What a range filter holds: no band (""), a band's key, or "custom" — then `min` and `max` are what was typed (raw
 * digits, "" = no bound on that side).
 */
export interface RangePick {
  band: string;
  min: string;
  max: string;
}

export const NO_RANGE: RangePick = { band: "", min: "", max: "" };

export const CUSTOM = "custom";

/** Whether a pick narrows anything — a band, or a custom range with at least one end typed. */
export function rangeOn(pick: RangePick): boolean {
  return pick.band === CUSTOM ? pick.min !== "" || pick.max !== "" : pick.band !== "";
}

/** The URL codec for a band — a band that no longer exists reads as none. */
export function bandCodec(bands: Band[]) {
  return oneOfCodec(["", CUSTOM, ...bands.map((b) => b.key)]);
}
