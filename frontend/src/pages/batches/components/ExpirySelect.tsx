import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import { BatchExpiryFilter } from "../../../gen/warehouse/inventory/v1/inventory_pb";

// THE EXPIRY FILTER — a plain list: three answers, static and small (a picker over data that grows is a search select;
// this one never grows). A Chakra Select, inline, so it works in the phone's filter sheet; with a pick its × clears it
// (every-filter-clears-from-its-own-x).
export function ExpirySelect({
  value,
  onChange,
}: {
  value: BatchExpiryFilter;
  onChange: (next: BatchExpiryFilter) => void;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: t("batches.expirySoon"), value: String(BatchExpiryFilter.EXPIRING_SOON) },
          { label: t("batches.expiryNone"), value: String(BatchExpiryFilter.NO_EXPIRY) },
        ],
      }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      width="full"
      value={value === BatchExpiryFilter.UNSPECIFIED ? [] : [String(value)]}
      onValueChange={(e) => {
        const picked = e.value[0];
        // Cleared is "every expiry" — the none sentinel, never nothing.
        onChange(picked ? (Number(picked) as BatchExpiryFilter) : BatchExpiryFilter.UNSPECIFIED);
      }}
      data-testid="batches-expiry"
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger aria-label={t("batches.expiryLabel")} data-testid="batches-expiry-trigger">
          <Select.ValueText placeholder={t("batches.expiryAll")} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.ClearTrigger data-testid="batches-expiry-clear" />
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`batches-expiry-option-${item.value}`}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
