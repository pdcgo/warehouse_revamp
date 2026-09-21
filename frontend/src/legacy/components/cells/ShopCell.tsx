import { Icon, Text } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { Tooltip } from "../feedback/Tooltip";
import { EntityCell } from "./EntityCell";
import { formatUnixDateTime } from "../../../lib/datetime";

export interface ShopCellData {
  id?: bigint | number;
  name?: string;
  username?: string;
  marketplace?: Marketplace;
  // Unix seconds. Non-zero means the storefront has been removed upstream.
  deletedAt?: bigint;
}

// ShopCell is how a storefront appears in a table row: its name, its marketplace, its handle — and,
// crucially, whether it still EXISTS.
//
// The deleted marker is the part worth explaining. Shops get removed on the marketplace side while
// their orders, settlements and payouts remain in this system forever, so a shop id in an old row
// may point at a storefront nobody can open any more. Without a marker the row looks live, and
// somebody spends ten minutes trying to reconcile against a shop that has not existed for months.
// The marker says "this record is historical" and its tooltip says since when.
export const description =
  "A storefront in a table row: name, marketplace badge, handle — plus a marker when the shop has been deleted upstream, so an old row is not mistaken for a live one.";

export interface ShopCellProps {
  shop?: ShopCellData;
  shopId?: bigint | number;
  loading?: boolean;
}

export function ShopCell({ shop, shopId, loading }: ShopCellProps) {
  const id = shop?.id ?? shopId;
  const deleted = shop?.deletedAt !== undefined && shop.deletedAt > 0n;

  return (
    <EntityCell
      loading={loading && !shop}
      media={
        shop?.marketplace !== undefined && shop.marketplace !== Marketplace.UNSPECIFIED ? (
          <MarketplaceBadge marketplace={shop.marketplace} size="sm" />
        ) : undefined
      }
      name={shop?.name}
      fallback={id !== undefined ? `#${id}` : undefined}
      secondary={
        shop?.username ? (
          <Text fontSize="xs" color="fg.muted" truncate>
            @{shop.username}
          </Text>
        ) : undefined
      }
      trailing={
        deleted ? (
          <Tooltip content={`Deleted ${formatUnixDateTime(shop!.deletedAt!)}`}>
            <Icon
              as={Trash2}
              boxSize="5"
              p="1"
              borderRadius="full"
              colorPalette="red"
              bg="colorPalette.subtle"
              color="colorPalette.fg"
              data-testid="shop-deleted"
              aria-label="This shop has been deleted"
            />
          </Tooltip>
        ) : undefined
      }
    />
  );
}
