import type { ReactNode } from "react";
import { Box, Stack, Text } from "@chakra-ui/react";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge } from "../badges/MarketplaceBadge";

export interface ShopItemProps {
  /**
   * Any shop-shaped object. Structural rather than an import of `Shop`, the way `CustomerAddress` is:
   * an order row holds a `shop_id` and resolves the name from a lookup, so the caller assembles this
   * from two places and should not have to build a whole `Shop` to do it.
   */
  shop: { name?: string; marketplace?: Marketplace; shopId?: bigint };
  /** Optional trailing content: a check, actions, etc. */
  action?: ReactNode;
}

// ShopItem is the shared way to show a shop: its name, and the marketplace it sells on.
//
// ⚠ THE MARKETPLACE IS NOT DECORATION — IT IS HALF THE NAME. A selling team runs several storefronts
// whose names are often near-identical: "Toko Jaya" on Shopee and "Toko Jaya" on Tokopedia. A shop
// name ALONE is ambiguous in exactly the places it matters — an order row, a settlement line, a
// payout — so the pair is what identifies it. `ShopSelect` already encodes the same rule for the
// picker; this is that rule everywhere else.
//
// ⚠ AN UNRESOLVED ID STILL RENDERS, as `Shop #12`. A list resolves names through a batched lookup,
// and a lookup that missed must read as a shop whose name we do not have — not as a blank cell,
// which reads as a shop that is not there. Same fallback `TeamItem` makes, for the same reason.
//
// NO AVATAR, and no marketplace logo. A shop has no uploaded image, so the only thing an avatar could
// draw is initials — decoration that pushes the name it decorates to the right. The badge already
// carries the marketplace in its own standard colour.
//
// ⚠ THE BADGE SITS UNDER THE NAME (owner), not beside it. Inline, the badge pushed the name into a
// narrow remainder of the cell and long shop names clipped at every width; stacked, the name gets the
// whole column and the marketplace reads as what it is — a qualifier on the name above it.
//
// This reverses an earlier inline version, which existed because that cell also carried the fulfilling
// warehouse on line two. The warehouse is its own column now, so line two is free.
//
// It is PRESENTATIONAL and fetches nothing: a list renders many of these, so a lookup here would be
// an N+1. The caller resolves the name once per page and passes it in.
export const description =
  "The shared way to show a shop — its name plus the marketplace as a standard-coloured MarketplaceBadge, because two storefronts often share a name and only the pair identifies one. An unresolved id falls back to `Shop #id` rather than a blank cell.";

export function ShopItem({ shop, action }: ShopItemProps) {
  const named = (shop.name ?? "").trim();
  const name = named || (shop.shopId !== undefined ? `Shop #${shop.shopId}` : "—");
  const marketplace = shop.marketplace;

  return (
    <Stack gap="0.5" w="full" minW="0" align="start" data-testid="shop-item">
      <Text fontWeight="medium" lineClamp={1} textAlign="start" minW="0" data-testid="shop-item-name">
        {name}
      </Text>

      {marketplace !== undefined && marketplace !== Marketplace.UNSPECIFIED && (
        <Box flexShrink="0">
          <MarketplaceBadge marketplace={marketplace} size="sm" />
        </Box>
      )}

      {action}
    </Stack>
  );
}
