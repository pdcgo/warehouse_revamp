import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";

// ONE OF A FEW FIXED CHOICES, AS A FILTER — the products list's lock and stock-age filters. A static, small set, so a
// plain list and not a search (a search over four options you can already see is a keystroke tax); an × on a pick that
// clears it back to "any" (every-filter-clears-from-its-own-x), emitting `undefined`, the "none" sentinel. Rendered
// inline (no Portal), as MarketplaceSelect is, so it also works inside the phone's Filter sheet.
export function ChoiceFilter<V extends string>({
  value,
  onChange,
  options,
  placeholder,
  testId,
}: {
  value: V | undefined;
  onChange: (value: V | undefined) => void;
  options: { value: V; label: string }[];
  placeholder: string;
  /** The trigger's test id; its × is `<testId>-clear` and each option `<testId>-option-<value>`. */
  testId: string;
}) {
  const collection = useMemo(() => createListCollection({ items: options }), [options]);

  return (
    <Select.Root
      collection={collection}
      value={value !== undefined ? [value] : []}
      onValueChange={(e) => onChange((e.value[0] as V | undefined) ?? undefined)}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          {/* Zag hides it while nothing is picked. */}
          <Select.ClearTrigger data-testid={`${testId}-clear`} />
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
