import { Field, HStack, Icon, Input, Text } from "@chakra-ui/react";
import { Clock } from "lucide-react";

/** A time-of-day window as `HH:mm`. `""` on a side is an open end. */
export interface TimeRange {
  from: string;
  to: string;
}

export const ALL_DAY: TimeRange = { from: "", to: "" };

/**
 * True when the window WRAPS PAST MIDNIGHT — `to` is earlier in the day than `from`.
 *
 * This is not an error, and treating it as one is the bug. A warehouse runs a night shift: 22:00 to
 * 06:00 is a real, common window, and a picker that rejected it would make the shift it describes
 * unrepresentable. A caller resolving this to timestamps has to add a day to the `to` side when this
 * returns true — which is exactly why it is exported rather than hidden.
 */
export function wrapsMidnight(range: TimeRange): boolean {
  if (!range.from || !range.to) return false;
  return range.to < range.from;
}

// TimeRangePicker picks a window WITHIN a day — a shift, a cut-off, a delivery slot.
//
// It is deliberately two native time inputs rather than a custom dial or a scrolling column picker.
// The native control is the one the platform already gives every user: it respects their locale's
// 12/24-hour convention, it is keyboard-first, and on a phone it opens the OS time wheel, which is
// far better than anything a web page rolls by hand. This matches the app's existing decision to use
// native date inputs inside a styled shell rather than a bespoke calendar.
//
// A wrapping window (22:00–06:00) is SUPPORTED and labelled, not rejected — see wrapsMidnight.
export const description =
  "A time-of-day window from two native time inputs. A window that wraps past midnight (22:00–06:00, the night shift) is supported and labelled, not treated as an error.";

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange(range: TimeRange): void;
  disabled?: boolean;
  fromLabel?: string;
  toLabel?: string;
}

export function TimeRangePicker({
  value,
  onChange,
  disabled,
  fromLabel = "From",
  toLabel = "To",
}: TimeRangePickerProps) {
  const overnight = wrapsMidnight(value);

  return (
    <HStack gap="2" align="flex-end" wrap="wrap" data-testid="time-range" data-overnight={overnight ? "true" : undefined}>
      <Field.Root disabled={disabled}>
        <Field.Label fontSize="xs">{fromLabel}</Field.Label>
        <Input
          type="time"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          data-testid="time-range-from"
        />
      </Field.Root>

      <Icon as={Clock} boxSize="4" color="fg.muted" mb="2" aria-hidden />

      <Field.Root disabled={disabled}>
        <Field.Label fontSize="xs">{toLabel}</Field.Label>
        <Input
          type="time"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          data-testid="time-range-to"
        />
      </Field.Root>

      {/* Labelled, not corrected. The reader needs to know the window crosses a date boundary,
          because that is what makes "the 22:00 shift" land on two calendar days. */}
      {overnight && (
        <Text fontSize="xs" color="fg.muted" mb="2" data-testid="time-range-overnight">
          overnight
        </Text>
      )}
    </HStack>
  );
}
