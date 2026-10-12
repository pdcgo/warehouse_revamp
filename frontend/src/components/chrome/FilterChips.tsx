import { Button, HStack } from "@chakra-ui/react";

export const description =
  "A filter as a row of rounded chips — All first, then each option; one is chosen at a time, drawn in the main tone. For a small, fixed set a person narrows by often (a store type), where seeing every option at once beats opening a picker. Wraps on a desktop; one row that scrolls sideways on a phone. Emits the chosen value, and the `all` value for All.";

export interface FilterChipOption<V extends string | number> {
  value: V;
  label: string;
}

export interface FilterChipsProps<V extends string | number> {
  value: V;
  onChange: (value: V) => void;
  /** The All chip's value — what "no narrowing" is held as (0, UNSPECIFIED, ""). */
  all: V;
  allLabel: string;
  options: FilterChipOption<V>[];
  /** Spoken name of the group. */
  ariaLabel: string;
  /** One row that scrolls sideways, instead of wrapping — for a phone. */
  scroll?: boolean;
  testId?: string;
}

// FILTER CHIPS (owner, on Discover's store type: *"filter jenis tokonya seperti ini"*, with a reference of rounded
// chips — All · Engineering · Design · Product; `a-store-type-filter-is-chips`). A view's quick narrowing, not a field on
// a form — so no radio mark (that is RadioPills), and every option is on screen, not behind a picker.
//
//   (Semua) (Shopee) (Tokopedia) (Lazada) (TikTok) (Blibli) (Bukalapak) (Other)
//    ↑ the chosen chip: pale rose, a rose border and label (a-chosen-option-is-in-the-main-tone)
//
// Buttons with `aria-pressed`, one pressed at a time — Chakra's Button carries the focus ring and the sizing.
export function FilterChips<V extends string | number>({
  value,
  onChange,
  all,
  allLabel,
  options,
  ariaLabel,
  scroll = false,
  testId = "filter-chips",
}: FilterChipsProps<V>) {
  const chips: FilterChipOption<V>[] = [{ value: all, label: allLabel }, ...options];

  return (
    <HStack
      role="group"
      aria-label={ariaLabel}
      gap="2"
      wrap={scroll ? "nowrap" : "wrap"}
      overflowX={scroll ? "auto" : undefined}
      // A sideways row keeps its last chip clear of the edge it scrolls under.
      pb={scroll ? "1" : undefined}
      data-testid={testId}
    >
      {chips.map((chip) => {
        const chosen = chip.value === value;

        return (
          <Button
            key={String(chip.value)}
            size="xs"
            borderRadius="full"
            flexShrink={0}
            px="3.5"
            variant={chosen ? "subtle" : "outline"}
            colorPalette={chosen ? "brand" : "gray"}
            borderWidth="1px"
            borderColor={chosen ? "brand.solid" : "border"}
            fontWeight="normal"
            aria-pressed={chosen}
            data-testid={`${testId}-${String(chip.value)}`}
            onClick={() => onChange(chip.value)}
          >
            {chip.label}
          </Button>
        );
      })}
    </HStack>
  );
}
