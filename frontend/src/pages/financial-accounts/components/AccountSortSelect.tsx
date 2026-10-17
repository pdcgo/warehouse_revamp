import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import type { SortState } from "../../../components/chrome/SortableHeader";

export type AccountSortKey = "name" | "provider";

const DEFAULT = "default";
const OPTIONS: [AccountSortKey, "asc" | "desc"][] = [
  ["name", "asc"],
  ["name", "desc"],
  ["provider", "asc"],
  ["provider", "desc"],
];

// The headings' sorts, for a PHONE — no headings to tap there, so the filter sheet carries them
// (`a-table-sorts-from-its-headings`). Plus the list's own order, which no heading stands for. A Chakra
// Select, inline: it lives in the filter sheet, a portal of its own.
export function AccountSortSelect({
  value,
  onChange,
}: {
  value: SortState<AccountSortKey> | null;
  onChange: (next: SortState<AccountSortKey> | null) => void;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: t("financialAccounts.sort.default"), value: DEFAULT },
          ...OPTIONS.map(([by, dir]) => ({ label: t(`financialAccounts.sort.${by}.${dir}`), value: `${by}:${dir}` })),
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
        const [by, dir] = picked.split(":") as [AccountSortKey, "asc" | "desc"];
        onChange({ by, dir });
      }}
    >
      <Select.HiddenSelect />
      <Select.Label>{t("financialAccounts.sort.label")}</Select.Label>
      <Select.Control>
        <Select.Trigger data-testid="account-sort-select">
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
