import type { TFunction } from "i18next";

// The rules for COUNTING A BOX at the door, in one place — the accept screen and its stories read them, and two
// copies of "what counts as counted" is how a screen's idea of valid drifts from the handler's.
//
// Per line the warehouse types two numbers: what is IN THE BOX, and how many of those are BROKEN
// (any-warehouse-member-counts-what-arrived). Everything else is worked out:
//
//   good    = received − broken      → becomes stock, on the placements named
//   missing = ordered − received     → a MISSING row (a-short-unit-at-the-door-is-missing)
//
// More in the box than ordered is refused — the selling team adds the extra by an edit first
// (accept-refuses-more-than-the-line-says).

// A count is held as a STRING while editing, because blank is not 0: `0` is a legitimate count (nothing of this line
// was in the box); BLANK means nobody has counted it yet. A blank is INVALID, not zero.
export function isCounted(raw: string): boolean {
  if (raw.trim() === "") return false;

  const n = Number(raw);

  return Number.isInteger(n) && n >= 0;
}

// Only called on a string `isCounted` has accepted.
export function toCount(raw: string): bigint {
  if (!isCounted(raw)) return 0n;

  return BigInt(Number(raw));
}

// Broken is optional to type — blank means none broke.
export function toBroken(raw: string): bigint {
  if (raw.trim() === "") return 0n;

  return toCount(raw);
}

// Whole rupiah from a typed field. Blank and rubbish are both 0.
export function toRupiah(raw: string): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0n;

  return BigInt(Math.trunc(n));
}

// More in the box than the line ordered — accept is refused until the selling team edits the line.
export function isOverCount(received: bigint, ordered: bigint): boolean {
  return received > ordered;
}

// Broken units are among those that arrived.
export function isBrokenOverReceived(broken: bigint, received: bigint): boolean {
  return broken > received;
}

// The good units, never below 0.
export function goodUnits(received: bigint, broken: bigint): bigint {
  const good = received - broken;

  return good > 0n ? good : 0n;
}

// The gap between what was ordered and what is in the box, as a phrase — "" when they match. The live hint while
// counting and the badge on the finished record both read it from here.
export function deltaLabel(t: TFunction, ordered: bigint, received: bigint): string {
  if (received === ordered) return "";
  if (received < ordered) return t("restock.receive.short", { n: (ordered - received).toString() });

  return t("restock.receive.over", { n: (received - ordered).toString() });
}

// What a unit cost BEFORE freight — the line's price divided by the good units. Shown beside the HPP so the person
// typing the courier's charge can see what the delivery added.
export function unitGoods(lineTotal: bigint, good: bigint): bigint {
  if (good <= 0n) return 0n;

  return lineTotal / good;
}

// HPP — what a good unit of this line ACTUALLY cost. Mirrors the accept handler, so the figure on screen is the one
// the batch freezes:
//
//   freight per unit = (shipment cost + the courier's charge) / good units across the WHOLE restock
//   hpp              = line total / that line's good units + freight per unit
//
// The courier's charge is OUTSIDE the restock's total and INSIDE the unit price
// (the-couriers-charge-stays-out-of-total, the-couriers-ask-is-in-the-unit-price). Rounded down at both steps, like
// the server. 0 when the line has no good units — "what did the units cost" has no answer when none became stock.
export function unitHpp(lineTotal: bigint, good: bigint, freight: bigint, goodAcrossRestock: bigint): bigint {
  if (good <= 0n) return 0n;

  const perUnit = goodAcrossRestock > 0n ? freight / goodAcrossRestock : 0n;

  return lineTotal / good + perUnit;
}
