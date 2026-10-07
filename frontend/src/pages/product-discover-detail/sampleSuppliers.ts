import { useDiscoverSuppliers, type DiscoverSupplier } from "../../features/suppliers/discover";
import type { SupplierChannelRecord } from "../../features/suppliers/adapt";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// ⚠ SAMPLE — which supplier stores list this product. Pending "suppliers" on this page.
//
// A supplier's products hang off its channels (products-hang-off-a-channel), so "who sells this product" is
// that table read backwards — and the table does not exist yet: a product is linked to a store when a restock
// bought there is accepted (restock-accepted-links-the-product-to-its-channel), which is not built. So the LINK
// is invented: the suppliers and stores are REAL, read across every team the way Discover Suppliers reads them,
// which keeps a click through to a supplier landing on the record it named. Deleted the day the links exist.

export interface ProductSupplierLink {
  supplier: DiscoverSupplier;
  channel: SupplierChannelRecord;
}

/** One large page of every team's suppliers — the pick needs a pool, not a window. */
const ALL = { q: "", channelType: Marketplace.UNSPECIFIED, ownerTeamId: 0n, page: 1, pageSize: 100 };

/** Up to two invented links, the same ones every time for the same product. */
export function useProductSupplierSample(args: { teamId: bigint | undefined; productId: bigint }) {
  const query = useDiscoverSuppliers({ teamId: args.teamId, ...ALL });

  const stocked = (query.data?.suppliers ?? []).filter((s) => s.channels.length > 0);
  const links: ProductSupplierLink[] = [];

  if (stocked.length > 0 && args.productId > 0n) {
    const first = Number(args.productId % BigInt(stocked.length));

    for (const offset of [0, 5]) {
      const supplier = stocked[(first + offset) % stocked.length]!;

      if (!links.some((l) => l.supplier.id === supplier.id)) {
        links.push({ supplier, channel: supplier.channels[Number(args.productId) % supplier.channels.length]! });
      }
    }
  }

  return { links, isPending: query.isPending };
}
