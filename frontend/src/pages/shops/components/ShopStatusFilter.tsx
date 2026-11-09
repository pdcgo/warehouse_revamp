import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import { SHOP_STATUS_FILTERS, type ShopStatusFilter } from "../../../features/shops/status";

// THE SHOPS LIST'S STATUS FILTER (a-shop-is-closed-never-deleted: *"the list shows `open`
// by default, `closed` by a filter"*). Three answers, a static and small set — a plain list, not a search:
//
//   [Open shops ▾]  →  Open shops · Closed shops · All shops
//
// Open is the default and is not a filter (no ×, not counted); picking Closed or All is, and the strip's Clear puts it
// back to Open. Held in the URL as `status` by the page. Inline, never portalled: on a phone it stands in the
// FilterBar's sheet, a modal Drawer, and a portalled list would open outside it, unclickable.
export function ShopStatusFilterSelect({
  value,
  onChange,
}: {
  value: ShopStatusFilter;
  onChange: (next: ShopStatusFilter) => void;
}) {
  const { t } = useTranslation();
  const collection = useMemo(
    () =>
      createListCollection({
        items: SHOP_STATUS_FILTERS.map((status) => ({ value: status, label: t(`shops.status.filter.${status}`) })),
      }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      value={[value]}
      onValueChange={(e) => {
        const picked = e.value[0] as ShopStatusFilter | undefined;
        if (picked) onChange(picked);
      }}
    >
      <Select.HiddenSelect aria-label={t("shops.status.label")} />
      <Select.Control>
        <Select.Trigger data-testid="shops-status-select" aria-label={t("shops.status.label")}>
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`shops-status-option-${item.value}`}>
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
