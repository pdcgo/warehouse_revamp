import { Badge, type BadgeProps } from "@chakra-ui/react";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// marketplaceLabel is the shared display name for a marketplace — the badge's text, the picker's
// options, and any caller that shows a marketplace. It lives HERE, with the colour, because this file
// owns how a marketplace is shown; MarketplaceSelect renders these badges, so it imports from here and
// never the other way round.
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

// The STANDARD colour for each marketplace, so a marketplace always looks the same everywhere it is
// shown (#84). One place owns the mapping; every view renders through MarketplaceBadge.
//
// The colours themselves are the marketplace's brand colour adapted per colour mode, and live in
// theme.ts (`marketplace.<name>.bg` / `.fg`, MARKETPLACE COLOURS) — this only picks which one. Anything
// without its own colour (Other, an unrecognised value) is `others`, a plain gray.
function marketplaceKey(m: Marketplace): string {
  switch (m) {
    case Marketplace.SHOPEE:
      return "shopee";
    case Marketplace.TOKOPEDIA:
      return "tokopedia";
    case Marketplace.LAZADA:
      return "lazada";
    case Marketplace.TIKTOK:
      return "tiktok";
    case Marketplace.BLIBLI:
      return "blibli";
    case Marketplace.BUKALAPAK:
      return "bukalapak";
    default:
      return "others";
  }
}

// MarketplaceBadge renders a shop's marketplace as a Chakra Badge in its standard colour (#84).
// This is THE way to show a marketplace type — never render the label as bare text.
export const description =
  "A shop's marketplace as a Chakra Badge in its brand colour, adapted for light and dark mode (Shopee orange-red, Tokopedia green, Lazada blue, …).";

export interface MarketplaceBadgeProps {
  marketplace: Marketplace;
  // Chakra Badge size — defaults to the theme default; pass "sm" for a compact table cell.
  size?: BadgeProps["size"];
}

export function MarketplaceBadge({ marketplace, size }: MarketplaceBadgeProps) {
  const key = marketplaceKey(marketplace);

  return (
    <Badge
      bg={`marketplace.${key}.bg`}
      color={`marketplace.${key}.fg`}
      size={size}
      data-testid={`marketplace-badge-${marketplace}`}
    >
      {marketplaceLabel(marketplace)}
    </Badge>
  );
}
