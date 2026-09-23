import { useTranslation } from "react-i18next";

import { DatePicker } from "./DatePicker";
import { dateTimeInputToUnix, unixToDateTimeInput } from "../../lib/datetime";

// Re-export the conversions so a caller imports the picker and its unit helper from one place.
export { dateTimeInputToUnix, unixToDateTimeInput };

export const description =
  "Single instant field — `DatePicker` with its time row on. The trigger is a button showing the chosen date AND time; the popover holds the calendar with a time input under it. Holds a `yyyy-mm-ddThh:mm` string (\"\" = unset), minute precision; pass `clearable` for an inline reset. Convert with `dateTimeInputToUnix`/`unixToDateTimeInput` (0 = unset). Local time — the value maps to the same wall clock the user sees, never UTC.";

export interface DateTimePickerProps {
  /** The chosen instant as `yyyy-mm-ddThh:mm`; `""` means nothing chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Bounds as `yyyy-mm-dd` — the calendar's floor and ceiling are DAYS. */
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Show an inline clear (×) once a value is set. */
  clearable?: boolean;
  testId?: string;
  placeholder?: string;
}

// DateTimePicker is the shared single-instant control: the date picker with its clock shown.
//
// ⚠ IT IS A NAME, NOT A SECOND IMPLEMENTATION. When both were native inputs this file carried its own
// markup, and the two drifted — different overlays, different clear buttons, and a time picker that
// could never gain the calendar the date one had. Now there is one calendar, one trigger, one clear,
// and this component's whole job is to say which of the two value shapes a caller is holding:
// `yyyy-mm-ddThh:mm` here, `yyyy-mm-dd` there, with the unit helpers to match.
export function DateTimePicker(props: DateTimePickerProps) {
  const { t } = useTranslation();

  // Its own empty-state wording: this control asks for a time as well, and "Choose a date" on a
  // button that also wants 09:30 is half a question.
  return (
    <DatePicker {...props} withTime placeholder={props.placeholder ?? t("dateTimePicker.placeholder")} />
  );
}
