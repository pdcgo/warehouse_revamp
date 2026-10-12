import { Button, DatePicker as ChakraDatePicker, Flex, Icon, IconButton, Input, Portal, Span, parseDate } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Calendar, X } from "lucide-react";
import {
  dateInputToUnix,
  dateTimeInputToUnix,
  formatUnixDate,
  formatUnixDateTime,
  unixToDateInput,
} from "../../lib/datetime";

// Re-export the conversions so a caller imports the picker and its unit helper from one place.
export { dateInputToUnix, unixToDateInput };

export const description =
  "Single calendar-date field, built on Chakra's DatePicker: the trigger is a BUTTON showing the chosen date, and the calendar opens in a popover (day → month → year views). Holds a `yyyy-mm-dd` string (\"\" = unset); pass `withTime` and it holds `yyyy-mm-ddThh:mm` and grows a time row under the calendar. `clearable` adds an inline reset. Convert with `dateInputToUnix`/`unixToDateInput` (0 = unset), the same second-based, local-time convention the whole picker family shares.";

export interface DatePickerProps {
  /** The chosen date as `yyyy-mm-dd` — or `yyyy-mm-ddThh:mm` with `withTime`. `""` means unset. */
  value: string;
  onChange: (value: string) => void;
  /** Bounds, as `yyyy-mm-dd`. A time on either is ignored: a ceiling is a DAY. */
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Show an inline clear (×) once a date is set. */
  clearable?: boolean;
  testId?: string;
  /**
   * Also pick a TIME (owner). The value becomes `yyyy-mm-ddThh:mm` and a time row appears under the
   * calendar — so one component covers both, instead of a day picker and an instant picker that
   * drift apart. `DateTimePicker` is this flag with its own name and its own unit helpers.
   */
  withTime?: boolean;
  /** What the trigger says while nothing is chosen. Defaults to the shared "Choose a date". */
  placeholder?: string;
}

// The shared single-date control (#117), rebuilt on Chakra's DatePicker (owner).
//
// ⚠ THE TRIGGER IS A BUTTON, not a text field, and that is the change with consequences. A native
// `<input type="date">` looks different in every browser, offers no month or year jump, cannot show
// a time beside the day, and is typed into by keyboard in a format that depends on the machine's
// locale. A button says what is chosen in OUR date format and opens OUR calendar — one rendering
// everywhere, keyboard reachable, and with somewhere to put the clock.
//
// The cost, stated plainly: a date can no longer be TYPED. Somebody entering last month's order picks
// it instead of typing it, which is more clicks and fewer typos. Tests and e2e that filled the input
// now open the calendar and click a day.
//
// ⚠ THE VALUE STAYS A STRING, in the shape the rest of the app already passes around — `yyyy-mm-dd`,
// or `yyyy-mm-ddThh:mm` with `withTime`. Chakra's picker works in `DateValue` objects; that stays
// INSIDE this component, so no caller has to learn a calendar library to hold a date.
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  clearable,
  testId,
  withTime = false,
  placeholder,
}: DatePickerProps) {
  const { t, i18n } = useTranslation();

  const [datePart, timePart] = splitValue(value);
  const showClear = clearable && !!value && !disabled;

  // What the button says. The app's own format, so a date reads the same here as it does in the table
  // the record ends up in.
  const label = value
    ? withTime
      ? formatUnixDateTime(dateTimeInputToUnix(value))
      : formatUnixDate(dateInputToUnix(value, false))
    : (placeholder ?? t("datePicker.placeholder"));

  function emit(date: string, time: string) {
    if (!date) {
      onChange("");
      return;
    }

    // A time of day only exists with a day: midnight is the honest default for a date picked before
    // anybody touched the clock, and it is what a `yyyy-mm-dd` value has always meant in seconds.
    onChange(withTime ? `${date}T${time || "00:00"}` : date);
  }

  return (
    <ChakraDatePicker.Root
      // The month names and the first day of the week follow the app's language, like every other
      // piece of copy on the screen.
      locale={i18n.language === "id" ? "id-ID" : "en-US"}
      disabled={disabled}
      positioning={{ placement: "bottom-start" }}
      value={toDateValue(datePart)}
      min={toDateValue(min)[0]}
      max={toDateValue(max)[0]}
      // ⚠ WITH A TIME ROW THE POPOVER STAYS OPEN on a day click — closing it would put the calendar
      // away before the person reached the clock underneath it.
      closeOnSelect={!withTime}
      // ⚠ `value`, NOT `valueAsString`. The string Ark hands back is formatted for the LOCALE —
      // "8/20/2026" in English, "20/8/2026" in Indonesian — and this component's whole contract is
      // that it emits `yyyy-mm-dd`. The CalendarDate's own `toString()` is the ISO one, in every
      // language, which is why the boundary is crossed here rather than by reformatting text.
      onValueChange={(e) => emit(e.value[0]?.toString() ?? "", timePart)}
    >
      {/* ⚠ THE CLEAR SITS INSIDE THE FIELD, laid over it — it is NOT a second item in a row.
          Beside the trigger it pushed the control past its container: the trigger is `w="full"`, so
          a sibling after it has nowhere to go and hangs off the edge of the card. Overlaying it is
          also what every other control here does (the combobox's ✕), and `pe` on the button keeps a
          long date from running underneath it. */}
      <ChakraDatePicker.Control position="relative" w="full">
        {/* SIZED LIKE A FIELD, from theme.ts — 36px tall, an 8px radius, a field's hover and focus.
            It is a button by SEMANTICS (it opens a calendar) and a field by APPEARANCE, because it
            sits in a form row holding a value. */}
        <ChakraDatePicker.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            w="full"
            pe={showClear ? "8" : undefined}
            disabled={disabled}
            data-testid={testId}
          >
            <Icon as={Calendar} boxSize="4" color="fg.muted" flexShrink="0" />
            {/* The placeholder is quieter than a value, the way every other control on the form
                tells "nothing chosen" from "this is the answer". */}
            <Span color={value ? undefined : "fg.subtle"} truncate>
              {label}
            </Span>
          </Button>
        </ChakraDatePicker.Trigger>

        {showClear && (
          <IconButton
            type="button"
            size="xs"
            variant="ghost"
            aria-label={t("datePicker.clear")}
            data-testid={testId ? `${testId}-clear` : undefined}
            onClick={() => onChange("")}
            position="absolute"
            insetEnd="1"
            top="50%"
            transform="translateY(-50%)"
            zIndex="1"
          >
            <Icon as={X} boxSize="4" />
          </IconButton>
        )}
      </ChakraDatePicker.Control>

      <Portal>
        <ChakraDatePicker.Positioner>
          <ChakraDatePicker.Content data-testid={testId ? `${testId}-content` : undefined}>
            {/* Three views, and the header is what moves between them: the month label is a button
                that opens the month grid, and the month grid's label opens the years. Jumping to
                "August last year" is two clicks instead of twelve presses of a chevron. */}
            <ChakraDatePicker.View view="day">
              <ChakraDatePicker.Header />
              <ChakraDatePicker.DayTable />
            </ChakraDatePicker.View>

            <ChakraDatePicker.View view="month">
              <ChakraDatePicker.Header />
              <ChakraDatePicker.MonthTable />
            </ChakraDatePicker.View>

            <ChakraDatePicker.View view="year">
              <ChakraDatePicker.Header />
              <ChakraDatePicker.YearTable />
            </ChakraDatePicker.View>

            {withTime && (
              <Flex align="center" gap="2" pt="2" px="1" pb="1">
                <Span fontSize="sm" color="fg.muted">
                  {t("datePicker.time")}
                </Span>
                {/* A NATIVE TIME INPUT, deliberately: hours and minutes are typed far faster than
                    they are clicked, and every platform already has a good control for it. The
                    calendar above is what the native date input could not do well. */}
                <Input
                  type="time"
                  size="sm"
                  w="32"
                  value={timePart}
                  disabled={disabled || !datePart}
                  data-testid={testId ? `${testId}-time` : undefined}
                  onChange={(e) => emit(datePart, e.target.value)}
                />
              </Flex>
            )}
          </ChakraDatePicker.Content>
        </ChakraDatePicker.Positioner>
      </Portal>
    </ChakraDatePicker.Root>
  );
}

// ── The string ⇄ DateValue boundary, kept in one place ──────────────────────────────────────────

/** `"2026-08-15T09:30"` → `["2026-08-15", "09:30"]`; a bare date → `["2026-08-15", ""]`. */
function splitValue(value: string): [string, string] {
  const [date = "", time = ""] = value.split("T");

  return [date, time];
}

/**
 * A `yyyy-mm-dd` string as Chakra's picker wants it, and `[]` for "nothing chosen".
 *
 * ⚠ GUARDED. `parseDate` THROWS on anything it cannot read, and this component is handed whatever a
 * form is holding — including the half-typed and the restored-from-somewhere-else. A bad string
 * renders as an empty picker, never as a crashed screen.
 */
function toDateValue(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return [];

  try {
    return [parseDate(date.slice(0, 10))];
  } catch {
    return [];
  }
}
