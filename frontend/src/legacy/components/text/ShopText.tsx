import { HStack, Stack, Text } from "@chakra-ui/react";
import type { StackProps } from "@chakra-ui/react";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { ClippedText } from "./ClippedText";

// ShopText is the standard way to name a shop: its name, its marketplace, and an optional second
// line of context.
//
// A selling team runs several storefronts whose names are often near-identical — "Toko Jaya" on
// Shopee and "Toko Jaya" on Tokopedia — so a shop name ALONE is ambiguous in exactly the places it
// matters (an order row, a settlement line, a payout). Pairing the name with the standard-coloured
// MarketplaceBadge makes the pair unique and keeps a marketplace looking the same here as in every
// table and dropdown.
//
// The name clips rather than wraps: these sit in table cells, and a shop name that wraps to a second
// line pushes every row in the column out of alignment. ClippedText keeps the full name a hover away.
export const description =
  "A shop as name + standard marketplace badge, with an optional second line. Two shops with the same name on different marketplaces stay distinguishable.";

export interface ShopTextProps extends Omit<StackProps, "children"> {
  name?: string;
  marketplace?: Marketplace;
  // A second, quieter line — an account id, a status, whatever the screen needs beside the shop.
  desc?: string;
}

export function ShopText({ name, marketplace, desc, ...rest }: ShopTextProps) {
  return (
    <Stack gap="0.5" lineHeight="short" minW="0" data-testid="shop-text" {...rest}>
      <HStack gap="1.5" minW="0">
        <ClippedText fontWeight="medium">{name || "—"}</ClippedText>
        {marketplace !== undefined && marketplace !== Marketplace.UNSPECIFIED && (
          <MarketplaceBadge marketplace={marketplace} size="sm" />
        )}
      </HStack>
      {desc && (
        <Text fontSize="xs" color="fg.muted" truncate>
          {desc}
        </Text>
      )}
    </Stack>
  );
}
