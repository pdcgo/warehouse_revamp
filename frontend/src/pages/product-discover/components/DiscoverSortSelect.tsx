import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import type { DiscoverSort } from "../../../features/products/queries";

export const DISCOVER_SORTS: readonly DiscoverSort[] = ["newest", "name", "sku"];

// HOW THE CARDS ARE ORDERED — the newest first (the server's own order), or by name or SKU, A to Z. A grid has no
// headings to sort from (`a-table-sorts-from-its-headings` is a table's), so it is a select: beside the search on a
// desktop, in the filter sheet on a phone. A Chakra Select, inline — the sheet is a portal of its own.
export function DiscoverSortSelect({
  value,
  onChange,
  label = false,
}: {
  value: DiscoverSort;
  onChange: (next: DiscoverSort) => void;
  /** Draw its own label — off beside the search, where "Terbaru" says what it is; the sheet's group labels it there. */
  label?: boolean;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () => createListCollection({ items: DISCOVER_SORTS.map((s) => ({ label: t(`discover.sort.${s}`), value: s })) }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      width="full"
      value={[value]}
      onValueChange={(e) => onChange((e.value[0] as DiscoverSort | undefined) ?? "newest")}
    >
      <Select.HiddenSelect />
      {label && <Select.Label>{t("discover.sort.label")}</Select.Label>}
      <Select.Control>
        <Select.Trigger aria-label={t("discover.sort.label")} data-testid="discover-sort">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`discover-sort-${item.value}`}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
