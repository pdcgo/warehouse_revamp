import { Badge } from "@chakra-ui/react";
import { Marketplace } from "../gen/warehouse/selling/v1/selling_pb";
import { marketplaceLabel } from "./MarketplaceSelect";

// The STANDARD colour for each marketplace, so a marketplace always looks the same everywhere it is
// shown (#84). One place owns the mapping; every view renders through MarketplaceBadge.
function marketplaceColor(m: Marketplace): string {
  switch (m) {
    case Marketplace.SHOPEE:
      return "orange";
    case Marketplace.TOKOPEDIA:
      return "green";
    case Marketplace.LAZADA:
      return "purple";
    case Marketplace.TIKTOK:
      return "pink";
    case Marketplace.BLIBLI:
      return "blue";
    case Marketplace.BUKALAPAK:
      return "red";
    default:
      return "gray";
  }
}

// MarketplaceBadge renders a shop's marketplace as a Chakra Badge in its standard colour (#84).
// This is THE way to show a marketplace type — never render the label as bare text.
export const description = "A shop's marketplace as a standard-coloured Chakra Badge (Shopee=orange, Tokopedia=green, …).";

export function MarketplaceBadge({ marketplace }: { marketplace: Marketplace }) {
  return (
    <Badge colorPalette={marketplaceColor(marketplace)} data-testid={`marketplace-badge-${marketplace}`}>
      {marketplaceLabel(marketplace)}
    </Badge>
  );
}
