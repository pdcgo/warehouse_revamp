// ⚠ INVENTED ROWS FOR KELUAR MASUK HARIAN (owner: *"keluar masuk harian kasih juga data dummynya"*) — nothing sums the
// movements per day yet. Here so the SHAPE can be judged; each page showing it carries its own ⚠ (`daily`, `sample`).
// Deterministic per product, so a story and a screenshot agree — the product's own page and its discover detail alike.

const DAY = 86_400;

/** Unix seconds `days` ago, at a fixed hour so a sample never reads as "just now". */
function daysBack(days: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now - days * DAY - (now % DAY) + 9 * 3600);
}

export interface SampleDay {
  dayUnix: bigint;
  /** Units that came in that day — receipts, returns, found. */
  inQty: number;
  /** Units that went out — picks, damage, lost. */
  outQty: number;
  /** On hand at the end of the day. */
  balance: number;
}

/** The last fourteen days, newest first, the balance walking back from today's. */
export function sampleDaily(productId: bigint, today: number): SampleDay[] {
  const n = Number(productId % 97n);
  const days: SampleDay[] = [];
  let balance = today;

  for (let i = 0; i < 14; i++) {
    const inQty = (i + n) % 4 === 0 ? 12 + ((n + i) % 3) * 6 : 0;
    const outQty = (i * 7 + n) % 5;
    days.push({ dayUnix: daysBack(i), inQty, outQty, balance });
    balance = Math.max(0, balance - inQty + outQty);
  }

  return days;
}
