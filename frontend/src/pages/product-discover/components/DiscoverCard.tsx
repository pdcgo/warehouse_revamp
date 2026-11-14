import { Stack } from "@chakra-ui/react";

import { ProductCard } from "../../../components/products/ProductCard";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import type { DiscoverStockRow, OwnerStockRow } from "../../../features/products/adapt";
import { DiscoverBadges } from "../../../features/products/DiscoverBadges";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { DISCOVER_PENDING } from "../pending";
import { DiscoverPrice } from "./DiscoverPrice";
import { DiscoverStock } from "./DiscoverStock";

// ONE DISCOVER CARD — the shared ProductCard with what Discover adds to it:
//
//   ┌──────────────────────────────┐
//   │ [Prioritas] ⚠ [🔒 Min 5 pcs] │   the division and the lock, on the cover (a-discover-card-says-locked-as-the-title-does)
//   │            cover             │
//   ├──────────────────────────────┤
//   │ Kopi Arabika 250g            │
//   │ SKU-KOPI-250                 │
//   │ Rp 79.000 – Rp 81.000        │   the cross price, red (a-discover-price-is-red-and-unlabelled)
//   │ Rp 70.000 – Rp 72.000        │   … and the cost under it, the team's own products only
//   │ ✓▢ 86 pcs  🚚 12 pcs         │   ready and on its way (a-discover-card-shows-its-stock)
//   │ [Toko Melati]                │
//   └──────────────────────────────┘
//
// Its own file to keep the page's grid short. Its states are pinned by the PAGE's stories (`Pages/Products/DiscoverProducts`
// — the Default story carries a locked product, locked with `patchProduct`): a story of its own read as
// another page in Storybook's sidebar (`the-card-states-are-pinned-on-the-page`).
export function DiscoverCard({
  product,
  teamName,
  own,
  ownStock,
  stock,
}: {
  product: Product;
  teamName?: string;
  /** The team standing here owns it — the cost shows too. */
  own: boolean;
  /** The owner's figures — only ever for an own product: its cost. */
  ownStock?: OwnerStockRow;
  /** The card's figures, whoever owns it — ready, on its way, the every-warehouse total, the cross price. */
  stock?: DiscoverStockRow;
}) {
  return (
    <ProductCard
      product={product}
      teamName={teamName}
      // The price, then the stock under it.
      details={
        <Stack gap="1.5">
          <DiscoverPrice productId={product.id} own={own} stock={stock} ownStock={ownStock} />
          <DiscoverStock productId={product.id} stock={stock} />
        </Stack>
      }
      // The division and the lock, ON THE COVER — the first thing seen. The lock reads the ready stock of EVERY warehouse,
      // as the product page's title does, so a minimum in force says Terkunci here too
      // (a-discover-card-says-locked-as-the-title-does).
      coverBadges={
        <DiscoverBadges
          product={product}
          totalReady={stock?.totalReadyQty}
          divisionMark={<NotImplemented list={DISCOVER_PENDING} id="divisionBadge" />}
        />
      }
    />
  );
}
