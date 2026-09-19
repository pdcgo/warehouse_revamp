import { DateText, type DateValue } from "../text/DateText";

// The GRAIN a date is read at. It is a question about the row, not about the value: a daily stock
// movement needs the clock, a monthly settlement does not, and showing "01 Aug 2026, 00:00" on a
// monthly row is three pieces of false precision.
export type DateGrain = "datetime" | "date" | "month" | "year" | "relative";

// DateCell is a timestamp in a table column, read at the grain the column is about.
//
// It exists as its own component rather than callers reaching for DateText because the GRAIN is a
// per-column decision that should be made once and stay made. Left to each call site, the same
// settlement date ends up rendered three different ways across three screens, and a reader
// comparing them cannot tell whether the difference is in the data or in the formatting.
export const description =
  "A timestamp in a table column at the grain that column is about (datetime / date / month / year / relative), so one date is not formatted three ways across three screens.";

export interface DateCellProps {
  value?: DateValue;
  grain?: DateGrain;
  // Shown when there is no usable timestamp. Defaults to the app's em dash.
  fallback?: string;
}

export function DateCell({ value, grain = "datetime", fallback }: DateCellProps) {
  if (grain === "month" || grain === "year") {
    // Month and year are the same absolute instant read coarsely — handled here rather than as two
    // more DateText variants, because they are only ever wanted in a column context.
    const date = value ? new Date(Number(toMillis(value))) : null;
    const text =
      date && !Number.isNaN(date.getTime()) && date.getTime() > 0
        ? date.toLocaleDateString(undefined, grain === "month" ? { month: "short", year: "numeric" } : { year: "numeric" })
        : (fallback ?? "—");

    return <span data-testid="date-cell">{text}</span>;
  }

  return <DateText value={value} variant={grain} fallback={fallback} data-testid="date-cell" />;
}

// Normalises the accepted shapes to milliseconds. Mirrors DateText's own coercion — kept private
// because only the coarse grains above need it.
function toMillis(value: DateValue): number {
  if (typeof value === "bigint") return Number(value) * 1000;
  if (typeof value === "number") return value * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}
