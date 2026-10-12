import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge, marketplaceLabel } from "../badges/MarketplaceBadge";

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
//
// COLOUR-CODED: every option, and the picked value in the closed trigger, is a MarketplaceBadge — a
// marketplace is never bare text, and the picker shows it exactly as every table and detail does. The
// badge carries the name, so the colour is never the only cue.
export const description =
  "Marketplace picker (Chakra Select), colour-coded: each option and the picked value is a MarketplaceBadge. Emits a Marketplace enum (a shop's storefront).";

export function MarketplaceSelect({
  value,
  onChange,
  placeholder = "Select a marketplace",
  disabled,
}: MarketplaceSelectProps) {
  const collection = useMemo(
    () =>
      createListCollection({
        items: MARKETPLACES.map((m) => ({ label: marketplaceLabel(m), value: String(m), marketplace: m })),
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
          {/* Read from the Select's own state rather than the `value` prop, so the badge follows the
              pick even when a caller leaves the picker uncontrolled. No pick → ValueText falls back to
              the placeholder. */}
          <Select.Context>
            {(select) => {
              const picked = select.value[0];

              return (
                <Select.ValueText placeholder={placeholder}>
                  {picked !== undefined ? <MarketplaceBadge marketplace={Number(picked) as Marketplace} /> : undefined}
                </Select.ValueText>
              );
            }}
          </Select.Context>
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
              <Select.ItemText>
                <MarketplaceBadge marketplace={item.marketplace} />
              </Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
