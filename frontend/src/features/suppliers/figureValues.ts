// THE TWO FIGURES' VALUES — Terjual with the last order, Siap with the last restock — for a supplier, one of its stores
// or one of its products (`sales-are-all-time-with-their-last-dates`, `the-detail-tabs-show-sold-and-ready`). Real for a
// supplier and a store (goods.ts, InventoryService.SupplierGoods); still invented for a product on the Produk tab
// (sampleSupplierFigures.ts), whose rows are themselves sample.

export interface SupplierFigureValues {
  /** Every unit sold — all time. */
  sold: number;
  /** The orders they went out on; absent where the figure is invented. */
  orders?: number;
  /** The last order, unix seconds; 0n = never sold. */
  lastOrderAt: bigint;
  /** Units ready on a shelf. */
  ready: number;
  /** Accepted restocks that brought them; absent where the figure is invented. */
  restocks?: number;
  /**
   * The last accepted restock, unix seconds. Absent where the row already says it — a product's row carries its
   * *Terakhir dibeli*, which is that date — or where nothing was ever restocked.
   */
  lastRestockAt?: bigint;
}

/** A count of units, written the way the app writes numbers — 1.240, not 1,240. */
export const units = (n: number) => n.toLocaleString("id-ID");
