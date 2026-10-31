import { useDiscoverSuppliers, type DiscoverSupplier } from "../suppliers/discover";
import type { SupplierChannelRecord } from "../suppliers/adapt";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// ⚠ SAMPLE — WHO SUPPLIES A PRODUCT, and at which of their stores it was bought. The product's own page and its discover
// detail both read THIS, so one product shows the same suppliers on both (owner: *"pemasok di keduanya ada toko
// pemasoknya"*, the-supplier-tab-names-the-store). Each page carries its own ⚠ (`suppliers`, `sample`).
//
// What is REAL and what is not:
//
//   the supplier, its team, its store and the store's link   real — every team's suppliers, read the way Discover
//                                                            Suppliers reads them, so a click lands on the record named
//   that THIS product was bought at THAT store                invented — the link (`supplier_channel_products`) is written
//                                                            when a restock bought there is accepted
//                                                            (restock-accepted-links-the-product-to-its-channel), not built
//   deliveries, units, the last cost and date                 invented — the batches name their supplier, but nothing
//                                                            groups them per supplier yet
//
// Deterministic per product, so a story and a screenshot agree. Deleted the day the links and the grouping exist.

export interface ProductSupplierRow {
  supplier: DiscoverSupplier;
  /** The supplier's store it was bought at. */
  channel: SupplierChannelRecord;
  /** How many deliveries came from it. */
  deliveries: number;
  /** Units delivered in all. */
  units: number;
  /** The unit cost of its last delivery, in rupiah — the owner's cost, shown on the owner's page only. */
  lastUnitCost: bigint;
  lastDeliveryUnix: bigint;
}

const DAY = 86_400;

/** Unix seconds `days` ago, at a fixed hour so a sample never reads as "just now". */
function daysBack(days: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now - days * DAY - (now % DAY) + 9 * 3600);
}

/** One large page of every team's suppliers — the pick needs a pool, not a window. */
const ALL = { q: "", channelType: Marketplace.UNSPECIFIED, ownerTeamId: 0n, page: 1, pageSize: 100 };

/** Two or three suppliers, the latest delivery first — the same ones every time for the same product. */
export function useProductSupplierSample(args: { teamId: bigint | undefined; productId: bigint }) {
  const query = useDiscoverSuppliers({ teamId: args.teamId, ...ALL });

  const stocked = (query.data?.suppliers ?? []).filter((s) => s.channels.length > 0);
  const rows: ProductSupplierRow[] = [];

  if (stocked.length > 0 && args.productId > 0n) {
    const n = Number(args.productId % 97n);
    const first = Number(args.productId % BigInt(stocked.length));

    for (const offset of [0, 5, 11].slice(0, 2 + (n % 2))) {
      const supplier = stocked[(first + offset) % stocked.length]!;

      if (rows.some((r) => r.supplier.id === supplier.id)) {
        continue;
      }

      const i = rows.length;
      rows.push({
        supplier,
        channel: supplier.channels[Number(args.productId) % supplier.channels.length]!,
        deliveries: 4 - i + (n % 3),
        units: (60 - i * 18) * (1 + (n % 2)),
        lastUnitCost: BigInt(45_000 + i * 1_500 + (n % 5) * 100),
        lastDeliveryUnix: daysBack(5 + i * 21 + (n % 7)),
      });
    }
  }

  return { rows, isPending: query.isPending };
}
