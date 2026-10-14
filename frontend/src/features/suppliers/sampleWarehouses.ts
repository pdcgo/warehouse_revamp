// ⚠ SAMPLE — INVENTED WAREHOUSES, for the supplier page's *Gudang terkait* (`a-supplier-page-is-scoped-by-its-warehouses`,
// `a-warehouse-chip-is-its-name-and-the-summary-follows-it`): the warehouses a supplier's restocks were received at,
// and what this supplier's goods did there. Nothing records where a supplier's goods were received yet, so each page
// that shows them marks them `sample`. Deleted the day the read exists.

export interface SupplierWarehouse {
  id: bigint;
  name: string;
  /** Units of this supplier's goods sold out of it — all time. */
  sold: number;
  /** The orders those units went out on. */
  orders: number;
  /** Units of this supplier's goods ready on its shelves. */
  ready: number;
  /** Accepted restocks from this supplier received there. */
  restocks: number;
  /** The last of them, unix seconds. */
  lastRestockAt: bigint;
  /** The last order of this supplier's goods out of it, unix seconds. */
  lastOrderAt: bigint;
}

/** What the summary under the chips reads — one warehouse, or every one together. */
export type WarehouseSummary = Omit<SupplierWarehouse, "id" | "name">;

// The Storybook warehouses first, so a story's warehouse filter and these chips name the same buildings.
const POOL: [id: bigint, name: string][] = [
  [11n, "Gudang Pusat"],
  [14n, "Gudang Cabang"],
  [901n, "Gudang Bandung"],
  [902n, "Gudang Surabaya"],
  [903n, "Gudang Medan"],
];

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);

/**
 * One to three warehouses, the same every render for the same supplier, the most restocked first. None for a supplier
 * with no store — nothing was bought from it.
 */
export function sampleWarehousesFor(supplierId: bigint, storeCount: number): SupplierWarehouse[] {
  if (storeCount === 0) return [];

  const n = Number(supplierId % 997n);
  const count = 1 + (n % 3);
  return Array.from({ length: count }, (_, i) => {
    const [id, name] = POOL[(n + i) % POOL.length]!;
    const restocks = Math.max(1, 14 - i * 5 - (n % 4));
    return {
      id,
      name,
      sold: restocks * (60 + ((n * 17 + i * 29) % 90)),
      orders: restocks * (6 + ((n * 7 + i * 11) % 12)),
      ready: 10 + ((n * 31 + i * 47) % 240),
      restocks,
      lastRestockAt: LATEST - BigInt(2 + i * 9 + (n % 5)) * DAY,
      lastOrderAt: LATEST - BigInt(i + (n % 3)) * DAY,
    };
  });
}

/**
 * The chosen warehouse's figures — or, for 0n, every warehouse's together: the units, orders and restocks summed, the
 * latest dates.
 */
export function warehouseSummary(warehouses: SupplierWarehouse[], warehouseId: bigint): WarehouseSummary | null {
  const scope = warehouseId === 0n ? warehouses : warehouses.filter((w) => w.id === warehouseId);
  if (scope.length === 0) return null;

  const latest = (pick: (w: SupplierWarehouse) => bigint) => scope.map(pick).reduce((a, b) => (a > b ? a : b));
  return {
    sold: scope.reduce((sum, w) => sum + w.sold, 0),
    orders: scope.reduce((sum, w) => sum + w.orders, 0),
    ready: scope.reduce((sum, w) => sum + w.ready, 0),
    restocks: scope.reduce((sum, w) => sum + w.restocks, 0),
    lastRestockAt: latest((w) => w.lastRestockAt),
    lastOrderAt: latest((w) => w.lastOrderAt),
  };
}
