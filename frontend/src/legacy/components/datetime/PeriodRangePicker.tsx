import { HStack } from "@chakra-ui/react";
import type { PeriodGrain } from "../../../lib/period";
import { DateRangePicker, type DateRange } from "../../../components/datetime/DateRangePicker";
import { MonthRangePicker, type MonthRange } from "./MonthRangePicker";
import { PeriodGrainPicker } from "../../../components/datetime/PeriodGrainPicker";
import { YearRangePicker, type YearRange } from "./YearRangePicker";

// The window, in whichever shape the current grain speaks. Keeping all three ALIVE rather than
// converting on every grain change is deliberate — see below.
export interface PeriodRange {
  grain: PeriodGrain;
  day: DateRange;
  month: MonthRange;
  year: YearRange;
}

// PeriodRangePicker is the grain and the window as ONE control: "monthly, Mar 2026 – Aug 2026".
//
// The pair already appears side by side on every reporting screen, because neither answers the
// question alone — a window without a grain does not say what a row is, and a grain without a window
// does not say how much. Binding them here means the RANGE CONTROL FOLLOWS THE GRAIN: choose Monthly
// and you get a month picker, not a day picker you are trusted to align to month boundaries.
//
// ⚠ THE THREE WINDOWS ARE KEPT SEPARATELY, and that is the design, not laziness. Converting on each
// grain change loses information both ways — months→days invents day boundaries the user never
// chose, and days→months silently widens their window. Keeping all three means flipping Monthly →
// Daily → Monthly returns the ORIGINAL month window rather than a lossy round-trip of it, which is
// what somebody comparing two resolutions of the same report actually expects.
export const description =
  "The grain and the window as one control — and the range picker FOLLOWS the grain, so Monthly gives a month picker. Each grain keeps its own window, so switching back and forth is lossless.";

export interface PeriodRangePickerProps {
  value: PeriodRange;
  onChange(value: PeriodRange): void;
  // Narrow the grains offered — only when the underlying series cannot answer at a resolution.
  grains?: PeriodGrain[];
  disabled?: boolean;
}

export function PeriodRangePicker({ value, onChange, grains, disabled }: PeriodRangePickerProps) {
  return (
    <HStack gap="2" wrap="wrap" align="center" data-testid="period-range" data-grain={value.grain}>
      <PeriodGrainPicker
        value={value.grain}
        onChange={(grain) => onChange({ ...value, grain })}
        grains={grains}
        disabled={disabled}
      />

      {value.grain === "day" && (
        <DateRangePicker
          value={value.day}
          onChange={(day) => onChange({ ...value, day })}
          disabled={disabled}
        />
      )}

      {value.grain === "month" && (
        <MonthRangePicker
          value={value.month}
          onChange={(month) => onChange({ ...value, month })}
          disabled={disabled}
        />
      )}

      {value.grain === "year" && (
        <YearRangePicker
          value={value.year}
          onChange={(year) => onChange({ ...value, year })}
          disabled={disabled}
        />
      )}
    </HStack>
  );
}
