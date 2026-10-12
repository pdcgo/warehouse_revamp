import { HStack, RadioCard } from "@chakra-ui/react";

export const description =
  "One choice among two to four, on a form: rounded pills, each with its radio mark and its label, the chosen one drawn in the main tone. A radio, not a segmented switch — it reads as a field to answer, and each option keeps its own width. Emits the option's value.";

export interface RadioPillOption<V extends string> {
  value: V;
  label: string;
  testId?: string;
}

export interface RadioPillsProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: RadioPillOption<V>[];
  /** Spoken name of the group — the field label it sits under. */
  ariaLabel: string;
  testId?: string;
}

// RADIO PILLS (owner: *"pill di modal form ganti jadi radio pill"*, `a-dialog-choice-is-a-radio-pill`) — the form's
// small either/or, a capital in or out, a fill-in or a move-in, a bank or a wallet. It replaced Chakra's segmented
// control in the account dialogs: a segment is a view switch, and these are answers to a field. Built on RadioCard,
// so the chosen pill takes the main tone from theme.ts (`a-chosen-option-is-in-the-main-tone`).
export function RadioPills<V extends string>({ value, onChange, options, ariaLabel, testId }: RadioPillsProps<V>) {
  return (
    <RadioCard.Root
      size="sm"
      value={value}
      onValueChange={(e) => e.value && onChange(e.value as V)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <HStack gap="2" wrap="wrap">
        {options.map((option) => (
          <RadioCard.Item
            key={option.value}
            value={option.value}
            flex="0 0 auto"
            borderRadius="full"
            data-testid={option.testId}
          >
            <RadioCard.ItemHiddenInput />
            <RadioCard.ItemControl px="3" py="1.5" gap="2" alignItems="center">
              <RadioCard.ItemIndicator />
              <RadioCard.ItemText>{option.label}</RadioCard.ItemText>
            </RadioCard.ItemControl>
          </RadioCard.Item>
        ))}
      </HStack>
    </RadioCard.Root>
  );
}
