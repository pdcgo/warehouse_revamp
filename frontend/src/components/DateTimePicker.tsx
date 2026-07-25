import { Box, Icon, IconButton, Input } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { dateTimeInputToUnix, unixToDateTimeInput } from "../lib/datetime";

// Re-export the conversions so a caller imports the picker and its unit helper from one place.
export { dateTimeInputToUnix, unixToDateTimeInput };

export const description =
  "Single instant field (Chakra Input type=\"datetime-local\"). Holds a `yyyy-mm-ddThh:mm` string (\"\" = unset), minute precision; pass `clearable` for an inline reset. Convert with `dateTimeInputToUnix`/`unixToDateTimeInput` (0 = unset). Local time — the value maps to the same wall clock the user sees, never UTC.";

export interface DateTimePickerProps {
  /** The chosen instant as `yyyy-mm-ddThh:mm`; `""` means nothing chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Bounds passed straight to the native input (`yyyy-mm-ddThh:mm`). */
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Show an inline clear (×) once a value is set. */
  clearable?: boolean;
  testId?: string;
}

// DateTimePicker is the shared single-instant field — DatePicker with a time-of-day. Same overlay
// approach: a bare <Input type="datetime-local"> keeps its Field wiring, with an optional clear
// button laid over it.
export function DateTimePicker({ value, onChange, min, max, disabled, clearable, testId }: DateTimePickerProps) {
  const { t } = useTranslation();
  const showClear = clearable && !!value && !disabled;

  return (
    <Box position="relative" w="full">
      <Input
        type="datetime-local"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        pe={showClear ? "2rem" : undefined}
      />
      {showClear ? (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          aria-label={t("dateTimePicker.clear")}
          tabIndex={-1}
          onClick={() => onChange("")}
          data-testid={testId ? `${testId}-clear` : undefined}
          position="absolute"
          top="50%"
          insetEnd="1.5rem"
          transform="translateY(-50%)"
        >
          <Icon as={X} boxSize="4" />
        </IconButton>
      ) : null}
    </Box>
  );
}
