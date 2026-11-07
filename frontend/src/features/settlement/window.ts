import { resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { toDateInputValue, todayWibDateInput } from "../../lib/datetime";

/**
 * A DateRange → the inclusive `yyyy-mm-dd` pair every settlement read filters on (the report's window,
 * the list's last-moved window).
 *
 * Through `resolveRange`, because a RELATIVE range stores a day COUNT and has no dates on it. The
 * instants come back in LOCAL time, so they are formatted back with the local formatter — `toISOString`
 * would shift the boundary by seven hours in Indonesia and ask for a window a day off the picker's.
 */
export function windowOf(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}

// THE WINDOW IN JAKARTA DAYS (a-table-date-is-short-and-every-time-is-wib, the-system-runs-on-jakarta-time).
//
// `windowOf` above cuts a relative range at the VIEWER's midnight (a known gap, recorded under
// a-table-date-is-short-and-every-time-is-wib: "moved when a filter is next touched"). A settlement day is a Jakarta
// `posted_on`, so the screens that read one — Shop Entries, and the settlement report (backlog #36) — resolve their
// window in Jakarta days: today is Jakarta's today, and a relative range counts back on that calendar date. An absolute
// range is already two days, and stays as typed.

function shift(day: string, days: number, months = 0): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (months !== 0) {
    // The same calendar day `months` back, clamped to that month's last day — resolveRange's rule.
    const first = new Date(Date.UTC(y, m - 1 - months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const back = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay) + days));
    return back.toISOString().slice(0, 10);
  }

  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A DateRange → the inclusive Jakarta days the list asks for; "" is an open end. */
export function jakartaWindowOf(range: DateRange, now: Date = new Date()): { from: string; to: string } {
  if (range.kind === "absolute") return { from: range.from, to: range.to };

  const today = todayWibDateInput(now);
  if (range.months !== undefined) {
    // "Last 1 month" on 15 Oct is 16 Sep – 15 Oct — a month of whole days, as resolveRange reads it.
    return { from: shift(today, 1, range.months), to: today };
  }

  return { from: shift(today, -(range.days - 1)), to: today };
}
