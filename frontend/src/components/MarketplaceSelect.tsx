import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";
import { Marketplace } from "../gen/warehouse/selling/v1/selling_pb";

// marketplaceLabel is the shared display name for a marketplace — used by the picker below and by
// callers that show a shop's marketplace read-only (e.g. a table cell).
export function marketplaceLabel(m: Marketplace): string {
  switch (m) {
    case Marketplace.SHOPEE:
      return "Shopee";
    case Marketplace.TOKOPEDIA:
      return "Tokopedia";
    case Marketplace.LAZADA:
      return "Lazada";
    case Marketplace.TIKTOK:
      return "TikTok";
    case Marketplace.BLIBLI:
      return "Blibli";
    case Marketplace.BUKALAPAK:
      return "Bukalapak";
    case Marketplace.OTHER:
      return "Other";
    default:
      return "Unspecified";
  }
}

// The marketplaces a shop may be on — UNSPECIFIED is excluded (it is the "not picked" sentinel).
export const MARKETPLACES: Marketplace[] = [
  Marketplace.SHOPEE,
  Marketplace.TOKOPEDIA,
  Marketplace.LAZADA,
  Marketplace.TIKTOK,
  Marketplace.BLIBLI,
  Marketplace.BUKALAPAK,
  Marketplace.OTHER,
];

export interface MarketplaceSelectProps {
  value?: Marketplace;
  onChange?: (m: Marketplace) => void;
  placeholder?: string;
  disabled?: boolean;
}

// MarketplaceSelect is the shared marketplace picker (#66), built on Chakra's composable Select. It
// emits a Marketplace enum, so callers work in the enum, not strings.
export const description = "Marketplace picker (Chakra Select). Emits a Marketplace enum (a shop's storefront).";

export function MarketplaceSelect({
  value,
  onChange,
  placeholder = "Select a marketplace",
  disabled,
}: MarketplaceSelectProps) {
  const collection = useMemo(
    () =>
      createListCollection({
        items: MARKETPLACES.map((m) => ({ label: marketplaceLabel(m), value: String(m) })),
      }),
    [],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined && value !== Marketplace.UNSPECIFIED ? [String(value)] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) {
          onChange?.(Number(picked) as Marketplace);
        }
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="marketplace-select">
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal on purpose: this Select is used inside a modal Dialog (ShopFormDialog), and a
          portalled listbox renders OUTSIDE the dialog where the modal makes it inert/aria-hidden —
          invisible to the a11y tree and unclickable. Rendering inline keeps it inside the dialog. */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value}>
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
