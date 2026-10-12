import { useEffect, useState } from "react";
import { Icon, Stack, Text, type TextProps } from "@chakra-ui/react";
import { CalendarDays, Clock } from "lucide-react";
import {
  formatUnixDate,
  formatUnixDateTime,
  formatUnixRelative,
  formatUnixTime,
} from "../../../lib/datetime";

// The forms a timestamp can arrive in across this app: unix seconds off an RPC (bigint), a JS Date
// from a picker, an RFC3339 string from the stock endpoints, or a plain number.
export type DateValue = bigint | number | Date | string | null | undefined;

// How the timestamp should READ. This is a question about the reader, not the data:
//   date      — the day is what matters; a time nobody needs is noise in a table cell
//   datetime  — the clock matters (two restocks the same morning)
//   time      — the clock ALONE, for a stacked layout that already shows the day
//   relative  — recency matters ("was this scanned just now, or before lunch?")
export type DateTextVariant = "date" | "datetime" | "time" | "relative";

// toUnix normalises every accepted shape to unix seconds, the one currency the lib formatters take.
// Anything unparseable becomes 0n, which the formatters already render as the em-dash "never" —
// so a malformed server value degrades to "no date" rather than "Invalid Date".
function toUnix(value: DateValue): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 0n : BigInt(Math.floor(ms / 1000));
  }

  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? 0n : BigInt(Math.floor(ms / 1000));
}

// DateText renders a timestamp in one of three readings, from any of the shapes an RPC hands us.
//
// The one thing it owns that a bare formatter call cannot: RELATIVE TIME GOES STALE. "a minute ago"
// left on screen for twenty minutes is worse than an absolute time, because it reads as fresh and
// nothing about it looks wrong. So the relative variant re-renders on a timer — and only that
// variant, since ticking an absolute date would be pure wasted renders on a table of 200 rows.
export const description =
  "A timestamp as date, date+time, or relative-to-now — taking unix seconds, a Date, or an RFC3339 string. The relative form re-renders on a timer so it can't go stale on screen.";

export interface DateTextProps extends Omit<TextProps, "children"> {
  value?: DateValue;
  variant?: DateTextVariant;
  // Shown instead when there is no usable timestamp. Defaults to the em dash the rest of the app
  // uses for "there is no date here".
  fallback?: string;
  // A prefix such as "Due " or "Updated ".
  addon?: string;
}

export function DateText({
  value,
  variant = "datetime",
  fallback,
  addon,
  ...rest
}: DateTextProps) {
  const unix = toUnix(value);

  // The tick exists only to force a re-render; its value is never read. A minute is the coarsest
  // interval at which the shortest relative unit ("x minutes ago") can change.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (variant !== "relative" || unix <= 0n) return;

    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [variant, unix]);

  if (unix <= 0n) {
    return (
      <Text as="span" color="fg.muted" data-testid="date-text" {...rest}>
        {fallback ?? "—"}
      </Text>
    );
  }

  const text =
    variant === "relative"
      ? formatUnixRelative(unix)
      : variant === "date"
        ? formatUnixDate(unix)
        : variant === "time"
          ? formatUnixTime(unix)
          : formatUnixDateTime(unix);

  return (
    <Text as="span" whiteSpace="nowrap" data-testid="date-text" {...rest}>
      {addon}
      {text}
    </Text>
  );
}

// StackedDateText splits the same timestamp over two lines — the day, then the clock beneath it in
// a quieter tone.
//
// It is for the case a single line handles badly: a narrow table column where the day is the
// primary fact and the time is a secondary one you only look at when two rows share a day. Stacking
// lets the column stay narrow while keeping both, where "25 Jul 2026, 14:30" on one line would
// force the column wider than everything else in the row.
export const stackedDescription =
  "The same timestamp over two lines — day above, clock below in a quieter tone — for narrow columns where both matter but only the day is scanned.";

export function StackedDateText({ value, fallback, ...rest }: Omit<DateTextProps, "variant">) {
  return (
    <Stack gap="0" lineHeight="short" data-testid="stacked-date-text">
      <Text as="span" display="inline-flex" alignItems="center" gap="1" {...rest}>
        <Icon as={CalendarDays} boxSize="3.5" color="fg.muted" />
        <DateText value={value} variant="date" fallback={fallback} />
      </Text>
      <Text as="span" display="inline-flex" alignItems="center" gap="1" fontSize="xs" color="fg.muted">
        <Icon as={Clock} boxSize="3" />
        <DateText value={value} variant="time" fallback="" />
      </Text>
    </Stack>
  );
}
