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

/**
 * How many CALENDAR DAYS ago a unix timestamp was — 0 for today, 1 for yesterday. `0n` (the RPC's
 * "never") and anything in the future return 0.
 *
 * Calendar days, not elapsed 24-hour periods, and the difference is the whole point of a "waiting
 * since" figure: a delivery raised at 23:00 last night has been waiting *since yesterday* to the crew
 * reading it at 08:00, even though barely nine hours have passed. Flooring the elapsed milliseconds
 * would call that 0 days and report a box that has already survived a shift change as "today".
 *
 * Both ends are taken to LOCAL midnight for the reason this whole module exists — a UTC comparison
 * shifts the boundary by seven hours in Indonesia, which is exactly where the off-by-one lives.
 */
export function daysSinceUnix(unix: bigint): number {
  if (unix <= 0n) return 0;

  const then = startOfDay(new Date(Number(unix) * 1000)).getTime();
  const today = startOfDay(new Date()).getTime();
  const days = Math.round((today - then) / 86_400_000);

  return days > 0 ? days : 0;
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

/**
 * unix seconds → a short human date ("25 Jul 2026"). `0n` (and anything below) is the RPC's "never",
 * and renders as an em dash — the same glyph an UNKNOWN uses, because to a reader both mean "there
 * is no date here", and the caller that needs to tell them apart already knows which it is holding.
 */
export function formatUnixDate(unix: bigint): string {
  if (unix <= 0n) return "—";

  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * unix seconds → a short human date AND TIME ("25 Jul 2026, 14:30"). Same "never" contract as
 * {@link formatUnixDate}.
 *
 * Use it where the CLOCK matters and not only the day: two restocks raised the same morning, or a
 * delivery accepted at 17:55 that somebody remembers arriving "at the end of the day". Where only
 * the day is meaningful, prefer formatUnixDate — a time nobody needs is noise in a table cell.
 */
export function formatUnixDateTime(unix: bigint): string {
  if (unix <= 0n) return "—";

  return new Date(Number(unix) * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * An RFC3339 timestamp STRING → the same "25 Jul 2026, 14:30" rendering as
 * {@link formatUnixDateTime}. The stock RPCs send a movement's `created_at` as a string rather than
 * unix seconds, and a ledger needs the clock: two movements on one morning are indistinguishable by
 * date alone, and "when did this stock move" is the whole point of the row.
 *
 * `""` is "no timestamp" and renders as the em dash the rest of this file uses. An UNPARSEABLE string
 * falls back to itself — showing the raw server value beats showing "Invalid Date", because it is at
 * least evidence of what arrived.
 */
export function formatRfc3339DateTime(rfc3339: string): string {
  if (!rfc3339) return "—";

  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339;

  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
