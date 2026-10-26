// HOW OLD A PRODUCT'S STOCK IS, and when it reads as stopped — shared by the list's Umur stok column and the product
// page's tile, so the two say the same number in the same tone.

/** Days on a shelf from which the oldest units read as stock that has stopped moving — the owner's to tune. */
export const STALE_STOCK_DAYS = 60;
/** Days without an order from which a product reads as quiet — the owner's to tune. */
export const QUIET_SALE_DAYS = 30;
/**
 * Ready units BELOW which a product reads as almost out (owner: *"order kebanyakan cuma 1-2"*, then *"oke di bawah
 * 5"*) — two or three orders' worth. The owner's to tune.
 */
export const LOW_STOCK_PCS = 5;

const DAY_SECONDS = 86_400;

/** Whole days from `unix` to now — never negative, so a clock a minute ahead does not read "-0 days". */
export function daysAgo(unix: bigint): number {
  return Math.max(0, Math.floor((Date.now() / 1000 - Number(unix)) / DAY_SECONDS));
}
