import { SegmentGroup } from "@chakra-ui/react";

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

// SegmentedRadio is a one-of-N choice rendered as a joined strip of segments.
//
// It is a RADIO GROUP in a small suit: same semantics, same keyboard behaviour, a fraction of the
// space. Use it where the options are two to four short words that need no explaining and the choice
// is a VIEW rather than a value — day/week/month, all/mine, list/grid. It sits comfortably in a
// toolbar, which a stack of radio buttons does not.
//
// ⚠ It is NOT ChoiceTabs, though they look similar. Segments are a form control that produces a
// value and can live inside a Field; ChoiceTabs is a filter strip over a list and supports being
// cleared. If the choice can be "none", it is not this.
export const description =
  "A one-of-N choice as a joined strip — a radio group in a small suit, for two to four short options that read as a VIEW (day/week/month). Not for choices that can be cleared.";

export interface SegmentedRadioProps<T extends string> {
  value?: T;
  onChange?(value: T): void;
  items: Array<SegmentItem<T>>;
  size?: "xs" | "sm" | "md" | "lg";
  disabled?: boolean;
}

export function SegmentedRadio<T extends string>({
  value,
  onChange,
  items,
  size = "sm",
  disabled,
}: SegmentedRadioProps<T>) {
  return (
    <SegmentGroup.Root
      value={value ?? null}
      onValueChange={(e) => e.value && onChange?.(e.value as T)}
      size={size}
      disabled={disabled}
      data-testid="segmented-radio"
    >
      <SegmentGroup.Indicator />
      {items.map((item) => (
        <SegmentGroup.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          data-testid={`segment-${item.value}`}
        >
          <SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  );
}
