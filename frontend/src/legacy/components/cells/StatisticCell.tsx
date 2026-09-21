import { Text } from "@chakra-ui/react";
import { CopyNumberPlain } from "../text/CopyNumber";
import { DateText, type DateValue } from "../text/DateText";

// What the figure IS, which decides how it is written and whether it is copyable.
export type StatisticKind = "number" | "price" | "percent" | "duration" | "date";

// formatDuration renders a span of SECONDS as the two largest units that fit — "2h 15m", "3d 4h".
//
// Two units, never one and never five. One ("2h") throws away the precision the reader is asking
// for when they look at a duration column at all; five ("2h 15m 3s 200ms") is a number nobody can
// compare against the row below it.
function formatDuration(seconds: number): string {
  const abs = Math.abs(Math.round(seconds));
  if (abs === 0) return "0s";

  const units: Array<[string, number]> = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ];

  const parts: string[] = [];
  let rest = abs;

  for (const [suffix, size] of units) {
    const amount = Math.floor(rest / size);
    if (amount > 0 || parts.length > 0) {
      if (amount > 0) parts.push(`${amount}${suffix}`);
      if (parts.length === 2) break;
    }
    rest -= amount * size;
  }

  return (seconds < 0 ? "-" : "") + parts.slice(0, 2).join(" ");
}

// StatisticCell is a MEASURE in a table column — a count, an amount, a rate, a duration, a date.
//
// Two things it owns that a bare number in a cell does not:
//
//  1. IT IS COPYABLE, AND COPIES THE RAW VALUE. These columns are the ones people paste into
//     spreadsheets to reconcile, and the display form ("Rp 1,5jt") is exactly what a spreadsheet
//     cannot accept.
//  2. IT IS TABULAR-NUMS AND END-ALIGNED. A measure column is read by scanning DOWN it, and that
//     only works if the digits line up — proportional digits make 1,000 narrower than 8,888 and the
//     column stops being a column.
export const description =
  "A measure in a table column — count, rupiah, percent, duration or date — right-aligned with lining digits, and click-to-copy of the RAW value for pasting into a spreadsheet.";

export interface StatisticCellProps {
  value?: number | bigint | DateValue;
  kind?: StatisticKind;
  compact?: boolean;
}

export function StatisticCell({ value, kind = "number", compact }: StatisticCellProps) {
  if (kind === "date") {
    return <DateText value={value as DateValue} variant="date" data-testid="statistic-cell" />;
  }

  const numeric = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;

  if (kind === "duration") {
    return (
      <Text as="span" fontVariantNumeric="tabular-nums" whiteSpace="nowrap" data-testid="statistic-cell">
        {formatDuration(numeric)}
      </Text>
    );
  }

  return (
    <CopyNumberPlain
      value={numeric}
      kind={kind}
      compact={compact}
      display="block"
      textAlign="end"
      data-testid="statistic-cell"
    />
  );
}
