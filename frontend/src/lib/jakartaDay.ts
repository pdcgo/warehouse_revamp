// THE JAKARTA DAY — one place where an instant, "today" or a picked date range becomes the business's calendar days
// (the-system-runs-on-jakarta-time: every day boundary, every report window and every "today" is the Jakarta day;
// a-table-date-is-short-and-every-time-is-wib: whatever the viewer's machine says).
//
// Every report and list on the server reads its days in Jakarta time — settlement's `posted_on`, the analytic and supplier
// folds, the financial account and Team Balance days, the order and restock lists' bounds. A window the screen cut at the
// VIEWER's midnight asked for a different set of days whenever the viewer was not in WIB: a laptop on UTC still reads
// yesterday from 00:00 to 07:00 WIB, one in Makassar has already started tomorrow from 23:00 WIB. So no screen cuts a day
// itself; each reads it from here (backlog #37 moved the last ones).
//
// Asia/Jakarta is UTC+7 all year — no daylight saving, no change of offset since 1964 — so a Jakarta day is PLAIN
// ARITHMETIC on the instant: shift by seven hours and read the UTC calendar. Nothing here reads the browser's zone (no
// `getDate()`, no `new Date(y, m, d)`, no `setHours`), which is what `jakartaDay.test.ts` pins by running the same
// instants under other zones. `now` is a parameter everywhere so the edges can be pinned without faking the clock.

import type { DateRange } from "../components/datetime/DateRangePicker";

const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 on the Jakarta calendar, for an instant in unix MILLISECONDS. */
function dayNumberOfMs(ms: number): number {
  return Math.floor((ms + JAKARTA_OFFSET_MS) / DAY_MS);
}

/** A day number → its `yyyy-mm-dd`, read off the UTC calendar (the number is already Jakarta's). */
function dayOfNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** `yyyy-mm-dd` → its day number; null when malformed. Calendar arithmetic only — no zone, no instant. */
function numberOfDay(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;

  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

/** The Jakarta `yyyy-mm-dd` an instant falls on. */
export function jakartaDayOf(at: Date): string {
  return dayOfNumber(dayNumberOfMs(at.getTime()));
}

/** TODAY in Jakarta, `yyyy-mm-dd`. */
export function jakartaToday(now: Date = new Date()): string {
  return jakartaDayOf(now);
}

/** unix SECONDS → the Jakarta `yyyy-mm-dd` it falls on; `0n` (and below, the RPC's "never") → `""`. */
export function jakartaDayOfUnix(unix: bigint): string {
  return unix <= 0n ? "" : dayOfNumber(dayNumberOfMs(Number(unix) * 1000));
}

/** A `yyyy-mm-dd` moved `n` calendar days (n may be negative). A malformed day comes back as it was. */
export function addDays(day: string, n: number): string {
  const d = numberOfDay(day);
  return d === null ? day : dayOfNumber(d + n);
}

/**
 * The same calendar day `months` back, clamped to that month's last day — 31 Mar − 1 month is 28 Feb, never an overflow
 * into 3 Mar. The quick ranges count months this way (the-quick-ranges-are-days-then-months-then-years).
 */
export function sameDayMonthsBack(day: string, months: number): string {
  const m = DAY_RE.exec(day);
  if (!m) return day;

  const first = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();

  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(Number(m[3]), lastDay))).toISOString().slice(0, 10);
}

/** The 1st of the month `months` before a day's month — `2026-11-07`, 11 → `2025-12-01`. */
export function firstOfMonthBack(day: string, months: number): string {
  const m = DAY_RE.exec(day);
  if (!m) return day;

  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - months, 1)).toISOString().slice(0, 10);
}

/** 00:00 WIB of a Jakarta day, in unix SECONDS — a window's lower bound. `""`/malformed → `0n` (an open end). */
export function jakartaDayStartUnix(day: string): bigint {
  const d = numberOfDay(day);
  return d === null ? 0n : BigInt((d * DAY_MS - JAKARTA_OFFSET_MS) / 1000);
}

/** 23:59:59 WIB of a Jakarta day, in unix SECONDS — a window's inclusive upper bound. `""`/malformed → `0n`. */
export function jakartaDayEndUnix(day: string): bigint {
  const d = numberOfDay(day);
  return d === null ? 0n : BigInt(((d + 1) * DAY_MS - JAKARTA_OFFSET_MS) / 1000 - 1);
}

/**
 * A DateRange → the INCLUSIVE Jakarta days it covers, `yyyy-mm-dd`; `""` is an open end (ALL_DATES is two of them).
 *
 * A relative range stores a COUNT, not dates, so it is resolved against Jakarta's today: "Last 7 days" is today and the
 * six days before it; "Last 1 month" on 15 Oct is 16 Sep – 15 Oct, the day after the same date a month back — a month of
 * whole days, the way seven days is seven. An absolute range is already two days, and stays as typed.
 */
export function jakartaWindowOf(range: DateRange, now: Date = new Date()): { from: string; to: string } {
  if (range.kind === "absolute") return { from: range.from, to: range.to };

  const today = jakartaToday(now);
  if (range.months !== undefined) {
    return { from: addDays(sameDayMonthsBack(today, range.months), 1), to: today };
  }

  return { from: addDays(today, -(range.days - 1)), to: today };
}

/**
 * A DateRange → the unix-SECONDS window an RPC with instant bounds filters on: 00:00 WIB of the first day through
 * 23:59:59 WIB of the last. `0n` is an open end on either side.
 */
export function jakartaUnixWindowOf(range: DateRange, now: Date = new Date()): { fromUnix: bigint; toUnix: bigint } {
  const { from, to } = jakartaWindowOf(range, now);

  return { fromUnix: jakartaDayStartUnix(from), toUnix: jakartaDayEndUnix(to) };
}

/** How many JAKARTA calendar days ago an instant (unix seconds) was — 0 for today; `0n` and the future are 0. */
export function jakartaDaysSince(unix: bigint, now: Date = new Date()): number {
  if (unix <= 0n) return 0;

  const days = dayNumberOfMs(now.getTime()) - dayNumberOfMs(Number(unix) * 1000);
  return days > 0 ? days : 0;
}
