import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import type { SortState } from "../../../components/chrome/SortableHeader";
import type { SupplierSortKey } from "../../../features/suppliers/queries";

const DEFAULT = "default";
const OPTIONS: [SupplierSortKey, "asc" | "desc"][] = [
  ["name", "asc"],
  ["name", "desc"],
];

// The heading's sort, for a PHONE — no headings to tap there, so the filter sheet carries it
// (`a-table-sorts-from-its-headings`). Plus the list's own order, newest first, which no heading stands for. A Chakra
// Select, inline: it lives in the filter sheet, a portal of its own.
export function SupplierSortSelect({
  value,
  onChange,
}: {
  value: SortState<SupplierSortKey> | null;
  onChange: (next: SortState<SupplierSortKey> | null) => void;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: t("suppliers.sort.default"), value: DEFAULT },
          ...OPTIONS.map(([by, dir]) => ({ label: t(`suppliers.sort.${by}.${dir}`), value: `${by}:${dir}` })),
        ],
      }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      width="full"
      value={[value ? `${value.by}:${value.dir}` : DEFAULT]}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (!picked || picked === DEFAULT) {
          onChange(null);
          return;
        }
        const [by, dir] = picked.split(":") as [SupplierSortKey, "asc" | "desc"];
        onChange({ by, dir });
      }}
    >
      <Select.HiddenSelect />
      <Select.Label>{t("suppliers.sort.label")}</Select.Label>
      <Select.Control>
        <Select.Trigger data-testid="supplier-sort-select">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
