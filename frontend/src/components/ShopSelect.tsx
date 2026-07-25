import { useMemo } from "react";
import { HStack, Select, Span, createListCollection } from "@chakra-ui/react";
import { useShopOptions } from "../features/shops/queries";
import type { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge } from "./MarketplaceBadge";

export interface ShopSelectProps {
  /** The selling team whose shops to list — a shop is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected shop id (0n = none). */
  value?: bigint;
  onChange?: (shopId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface ShopItem {
  label: string;
  value: string;
  marketplace: Marketplace;
}

// ShopSelect is the shared marketplace-shop picker for a selling team (#90). A team runs a handful of
// shops, so — like ShippingSelect over the courier catalogue — it loads them all once rather than
// paging or searching. It emits a shop id; each option shows the shop's name AND its marketplace as
// the standard-coloured MarketplaceBadge (#84), so two shops with similar names stay distinguishable
// and a shop's marketplace reads the same here as everywhere else.
export const description = "Marketplace-shop picker for a selling team (Chakra Select over ShopList). Emits a shop id; each option carries the shop's name and its standard-coloured MarketplaceBadge.";

export function ShopSelect({
  teamId,
  value,
  onChange,
  placeholder = "Select a shop",
  disabled,
}: ShopSelectProps) {
  // Read through the cache rather than fetching here (#176's gap, found via a flaky e2e).
  //
  // The hand-rolled version fetched ONCE in an effect keyed on `teamId`, and on failure set an error
  // and stopped: the effect could not re-run because the team had not changed, so a single transient
  // failure left this control permanently empty — "Shops unavailable" with no way back but a reload.
  // See src/shops/queries.ts for the full note.
  const query = useShopOptions({ teamId });

  const shops = query.data ?? [];
  const error = query.isError;

  const collection = useMemo(
    () =>
      createListCollection<ShopItem>({
        items: shops.map((shop) => ({
          label: shop.name,
          value: shop.id.toString(),
          marketplace: shop.marketplace,
        })),
      }),
    [shops],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={value && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        onChange?.(picked ? BigInt(picked) : 0n);
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="shop-select">
          <Select.ValueText placeholder={error ? "Shops unavailable" : placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal on purpose: this Select is used inside a modal Dialog (RecordExpenseDialog), and a
          portalled listbox renders OUTSIDE the dialog where the modal makes it inert/aria-hidden —
          invisible to the a11y tree and unclickable. Rendering inline keeps it inside the dialog.
          (Same reasoning as MarketplaceSelect.) */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`shop-select-option-${item.value}`}>
              <HStack gap="2">
                <Span>{item.label}</Span>
                <MarketplaceBadge marketplace={item.marketplace} size="sm" />
              </HStack>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
