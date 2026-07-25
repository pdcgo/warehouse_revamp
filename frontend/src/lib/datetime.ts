// Shared date/time math for the picker family (DatePicker, DateTimePicker, DateRangePicker,
// DateTimeRangePicker). One place so every picker agrees on two things that are easy to get subtly
// wrong: LOCAL time (never UTC) and the unix-SECONDS, 0-is-an-open-end convention the RPC filters use.
//
// Why local, not UTC: `new Date("2026-01-01")` parses as UTC midnight, which is the day BEFORE for
// anyone behind UTC (all of Indonesia is UTC+7/8/9). A warehouse filter that silently shifts a day is
// the exact bug these helpers exist to prevent, so every parse builds the Date from parts in local time.

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** A Date → unix SECONDS (the RPC unit). */
export function unixSeconds(d: Date): bigint {
  return BigInt(Math.floor(d.getTime() / 1000));
}

/** A `<input type="date">` value (`yyyy-mm-dd`) parsed at LOCAL midnight. `""`/malformed → null. */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A `<input type="datetime-local">` value (`yyyy-mm-ddThh:mm`) parsed in LOCAL time. `""`/malformed → null. */
export function parseLocalDateTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Zero-pad to width 2 — building input strings by hand, because toISOString would convert to UTC.
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date → the `yyyy-mm-dd` a `type="date"` input wants (local). */
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A Date → the `yyyy-mm-ddThh:mm` a `type="datetime-local"` input wants (local). */
export function toDateTimeInputValue(d: Date): string {
  return `${toDateInputValue(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** unix seconds → a `type="date"` value; `0n` → `""` (unset). */
export function unixToDateInput(unix: bigint): string {
  return unix === 0n ? "" : toDateInputValue(new Date(Number(unix) * 1000));
}

/** unix seconds → a `type="datetime-local"` value; `0n` → `""` (unset). */
export function unixToDateTimeInput(unix: bigint): string {
  return unix === 0n ? "" : toDateTimeInputValue(new Date(Number(unix) * 1000));
}

/**
 * A `type="date"` value → unix seconds. `atEndOfDay` takes 23:59:59 of that day (so a same-day record
 * falls inside a range's upper bound); otherwise 00:00:00. `""` → `0n` (an open end).
 */
export function dateInputToUnix(s: string, atEndOfDay: boolean): bigint {
  const d = parseLocalDate(s);
  if (!d) return 0n;
  return unixSeconds(atEndOfDay ? endOfDay(d) : startOfDay(d));
}

/** A `type="datetime-local"` value → unix seconds (to the minute). `""` → `0n` (an open end). */
export function dateTimeInputToUnix(s: string): bigint {
  const d = parseLocalDateTime(s);
  return d ? unixSeconds(d) : 0n;
}

// ── Calendar-grid helpers (the RangeCalendar month view) ────────────────────────────────────────
// yyyy-mm-dd strings compare lexically the same as chronologically (fixed width, zero-padded), so the
// pickers order a range with plain `<`/`>` on the strings — no Date round-trip, no timezone risk.

/** First day of d's month, at local midnight. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** d shifted by n whole months (n may be negative), landing on the 1st (so a short month can't clamp). */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * The fixed 6-week (42-day) grid covering `viewMonth`, each week starting Sunday. Leading/trailing days
 * spill into the neighbouring months so the grid is always the same height — no layout jump month to
 * month. All dates are local.
 */
export function monthGrid(viewMonth: Date): Date[] {
  const first = startOfMonth(viewMonth);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
