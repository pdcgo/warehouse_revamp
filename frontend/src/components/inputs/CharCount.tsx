import { Text } from "@chakra-ui/react";

export const description =
  "How much of a text field's limit is used — \"5/64\" — under the field, at its end. Give the field the same limit as `maxLength`, so the box stops where the server would refuse; at the limit the count turns amber, saying why nothing more goes in.";

// A FIELD WITH A LIMIT SAYS IT (owner: *"karena aku tahu ada batas di sini, inputnya harus kasih tahu batas juga misal
// 5/64"*, `a-limited-field-shows-its-count`). Without it the limit is met only as a refusal after Save — a reason shown at
// the top of the page about a field somewhere below it. The count is the field's own `maxLength`, mirrored from the
// proto's `max_len`, so the box, the count and the server agree on one number.
//
// It counts what the box counts (UTF-16 units, as `maxLength` does), which is never more permissive than the server's
// character count — an emoji uses two here and one there, so the box refuses first, never the server.
export function CharCount({ value, max, testId }: { value: string; max: number; testId?: string }) {
  const full = value.length >= max;

  return (
    <Text
      textStyle="xs"
      alignSelf="flex-end"
      color={full ? "warning.fg" : "fg.muted"}
      fontVariantNumeric="tabular-nums"
      aria-live="polite"
      data-full={full ? "true" : undefined}
      data-testid={testId}
    >
      {value.length}/{max}
    </Text>
  );
}
