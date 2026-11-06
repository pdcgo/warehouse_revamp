// THE "EXPIRING SOON" RULE — one place, the server's (inventory_v1 batch_list.go `soonCutoff`).
//
// A batch is expiring soon when it expires on a JAKARTA day up to and including today + 30 — already-expired batches
// included, as the server's EXPIRING_SOON filter and its `expiringSoonCount` include them. The cutoff is the START of
// Jakarta day today + 31, and a batch is soon when it expires strictly before it.
//
// ⚠ Calendar days, not `now + 30 × 24 h`: that window drifted with the hour the screen was opened — at 23:30 WIB a batch
// expiring late on the 30th day read normal on the screen while the server already counted it soon. And JAKARTA days,
// never the browser's (the-system-runs-on-jakarta-time): a laptop on UTC or in Makassar cut the day hours apart, so the
// amber colour disagreed with the list's own count. Asia/Jakarta is UTC+7 all year (no daylight saving), so the day is
// plain arithmetic on the instant — nothing here reads the browser's zone.
//
// `now` is a parameter so the edges can be pinned without faking the clock.

const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The days a batch stays "soon" for, counted from today in Jakarta, today included. */
export const EXPIRING_SOON_DAYS = 30;

/** The first instant (unix ms) that is NOT expiring soon: 00:00 WIB of the Jakarta day today + 31. */
export function expiringSoonCutoffMs(now: Date = new Date()): number {
  const jakartaDay = Math.floor((now.getTime() + JAKARTA_OFFSET_MS) / DAY_MS);

  return (jakartaDay + EXPIRING_SOON_DAYS + 1) * DAY_MS - JAKARTA_OFFSET_MS;
}

/** True when a batch expiring at `expiresOnUnix` (unix SECONDS; `0n` = no expiry) is expiring soon — the amber state. */
export function isExpiringSoon(expiresOnUnix: bigint, now: Date = new Date()): boolean {
  if (expiresOnUnix <= 0n) return false;

  return Number(expiresOnUnix) * 1000 < expiringSoonCutoffMs(now);
}
