import type { ElementType, ReactNode } from "react";
import { HStack, Icon, RadioGroup as ChakraRadioGroup, Stack, Text } from "@chakra-ui/react";

export interface RadioItem<T extends string> {
  value: T;
  label: ReactNode;
  // A lucide component shown before the label.
  icon?: ElementType;
  // A second line explaining what choosing this MEANS.
  description?: string;
  disabled?: boolean;
  hidden?: boolean;
}

// RadioGroup is a one-of-N choice where the options need EXPLAINING, not just naming.
//
// That is the line between this and a Select. A dropdown hides the options until asked and shows one
// line each — right for "which supplier", where the reader already knows what a supplier is and
// there are fifty of them. A radio group shows every option at once with room for an icon and a
// sentence — right for "how should this be counted", "what kind of adjustment is this", where there
// are three options and choosing wrongly means an incorrect stock record.
//
// Options that need a `description` are the tell: if the label alone is not enough, a dropdown was
// the wrong control.
export const description =
  "A one-of-N choice that SHOWS every option with an icon and an explanation — for decisions where the label alone is not enough. If the options need no explaining, use a Select.";

export interface RadioGroupProps<T extends string> {
  value?: T;
  onChange?(value: T): void;
  items: Array<RadioItem<T>>;
  // Lay the options out in a row. Only for short labels with no descriptions.
  horizontal?: boolean;
  disabled?: boolean;
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  items,
  horizontal,
  disabled,
}: RadioGroupProps<T>) {
  return (
    <ChakraRadioGroup.Root
      value={value ?? null}
      onValueChange={(e) => e.value && onChange?.(e.value as T)}
      disabled={disabled}
      colorPalette="brand"
      data-testid="radio-group"
    >
      <Stack direction={horizontal ? "row" : "column"} gap={horizontal ? "4" : "2"}>
        {items
          .filter((i) => !i.hidden)
          .map((item) => (
            <ChakraRadioGroup.Item
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              data-testid={`radio-${item.value}`}
              alignItems="flex-start"
            >
              <ChakraRadioGroup.ItemHiddenInput />
              <ChakraRadioGroup.ItemIndicator />
              <ChakraRadioGroup.ItemText>
                <HStack gap="1.5">
                  {item.icon && <Icon as={item.icon} boxSize="4" />}
                  {item.label}
                </HStack>
                {/* The explanation is INSIDE the label, so clicking it selects the option. A
                    description rendered as a sibling is a click target that looks selectable and
                    is not. */}
                {item.description && (
                  <Text fontSize="xs" color="fg.muted" fontWeight="normal">
                    {item.description}
                  </Text>
                )}
              </ChakraRadioGroup.ItemText>
            </ChakraRadioGroup.Item>
          ))}
      </Stack>
    </ChakraRadioGroup.Root>
  );
}
