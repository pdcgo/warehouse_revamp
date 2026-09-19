import { Box, Icon, IconButton, Input } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { dateInputToUnix, unixToDateInput } from "../../lib/datetime";

// Re-export the conversions so a caller imports the picker and its unit helper from one place.
export { dateInputToUnix, unixToDateInput };

export const description =
  "Single calendar-date field (Chakra Input type=\"date\"). Holds a `yyyy-mm-dd` string (\"\" = unset); pass `clearable` for an inline reset. Convert with `dateInputToUnix`/`unixToDateInput` (0 = unset), the same second-based, local-time convention the whole picker family shares.";

export interface DatePickerProps {
  /** The chosen date as `yyyy-mm-dd`; `""` means nothing chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Bounds passed straight to the native input (`yyyy-mm-dd`). */
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Show an inline clear (×) once a date is set. */
  clearable?: boolean;
  testId?: string;
}

// DatePicker is the shared single-date field. It wraps a bare <Input type="date"> — so it keeps its
// surrounding Field's label/required/aria wiring, exactly like PasswordInput — and lays an optional
// clear button over it rather than nesting an InputGroup, which would sever that Field association.
export function DatePicker({ value, onChange, min, max, disabled, clearable, testId }: DatePickerProps) {
  const { t } = useTranslation();
  const showClear = clearable && !!value && !disabled;

  return (
    <Box position="relative" w="full">
      <Input
        type="date"
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
          aria-label={t("datePicker.clear")}
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
