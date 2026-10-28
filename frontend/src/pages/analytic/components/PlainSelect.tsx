import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";

export interface PlainSelectItem {
  value: string;
  label: string;
}

// A short, fixed list in Chakra's composable Select — the group, the phone's sort, and the sample entity filters.
//
// Inline, never portalled: on a phone these sit inside the FilterBar's bottom sheet, and a portalled listbox would open
// outside it. The options carry `<testId>-option-<value>` so a story picks one by name.
export function PlainSelect({
  items,
  value,
  onChange,
  placeholder,
  ariaLabel,
  testId,
}: {
  items: PlainSelectItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  testId: string;
}) {
  const collection = useMemo(() => createListCollection({ items }), [items]);

  return (
    <Select.Root
      collection={collection}
      value={value ? [value] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) onChange(picked);
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId} aria-label={ariaLabel}>
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
