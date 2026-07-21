import type { TFunction } from "i18next";

// The rules for COUNTING A DELIVERY, in one place (#133/#154).
//
// Extracted from the receive dialog when the Accept screen (#157) replaced it: the same rules now
// govern a bigger form, and two copies of "what counts as counted" is how a screen's idea of valid
// drifts from the handler's.

// A count is held as a STRING while editing, because blank is not 0 — and here that distinction has
// teeth. `0` is a legitimate count (the line never turned up); BLANK means nobody has counted it yet.
// Submitting a blank as 0 would silently write off a line no one looked at, which is the exact failure
// the server refuses an incomplete `lines` array to prevent. So a blank is INVALID, not zero: to say
// nothing arrived you type 0 and mean it.
export function isCounted(raw: string): boolean {
  if (raw.trim() === "") return false;

  const n = Number(raw);

  return Number.isInteger(n) && n >= 0;
}

// Only ever called on a string `isCounted` has already accepted. There is deliberately no upper bound
// — 11 against 10 asked is over-delivery, which is real, and a cap would only force the person
// counting to write down a number they can see is wrong.
export function toReceived(raw: string): bigint {
  if (!isCounted(raw)) return 0n;

  return BigInt(Number(raw));
}

// Whole rupiah from a typed field. Blank and rubbish are both 0 — unlike a count, a blank price is not
// a distinct state worth defending: 0 is a legitimate cost (a sample, a transfer) and the difference
// between "free" and "not typed yet" is not one this form has to carry.
export function toRupiah(raw: string): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0n;

  return BigInt(Math.trunc(n));
}

// A place is owed exactly when goods arrived — the server's rule, mirrored: `received_quantity > 0`
// REQUIRES a placement, `== 0` forbids one. An UNCOUNTED line owes nothing yet: it is already blocked
// by the count itself, and until someone writes a number down there is no question of where goods went.
export function needsPlace(raw: string): boolean {
  return isCounted(raw) && toReceived(raw) > 0n;
}

// Counted zero — someone looked and the line was not there. NOT the same as an uncounted blank, and
// the distinction is the same one `isCounted` draws: 0 is an answer, blank is the absence of one.
export function noneArrived(raw: string): boolean {
  return isCounted(raw) && toReceived(raw) === 0n;
}

// The gap between what was asked for and what arrived, as a phrase — "" when they match. The live hint
// while counting and the badge on the finished record both read it from here, so the same discrepancy
// can never be phrased two ways.
export function deltaLabel(t: TFunction, asked: bigint, arrived: bigint): string {
  if (arrived === asked) return "";
  if (arrived < asked) return t("restock.receive.short", { n: (asked - arrived).toString() });

  return t("restock.receive.over", { n: (arrived - asked).toString() });
}

// HPP — what a unit of this line ACTUALLY cost, freight included (#155). Mirrors StockCost's SQL so
// the figure on screen is the one the order will book:
//
//   additional = (shipping + cod) / sellable units across the WHOLE request
//   hpp        = (line total / that line's sellable units) + additional
//
// Rounded DOWN at both steps, like the server — and shown live, because the person typing the COD fee
// is entitled to see what it does to the cost before they commit to it.
//
// 0 when the line received nothing: "what did the units cost" has no answer when none came, and the
// server skips such a line rather than dividing by its zero.
export function unitHpp(
  lineTotal: bigint,
  lineReceived: bigint,
  freight: bigint,
  sellableAcrossRequest: bigint,
): bigint {
  if (lineReceived <= 0n) return 0n;

  const additional = sellableAcrossRequest > 0n ? freight / sellableAcrossRequest : 0n;

  return lineTotal / lineReceived + additional;
}
