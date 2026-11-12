// KOREKSI HARGA'S BOOK — every price correction a story made (InventoryService.BatchRevalue, batchPriceStub.ts), and each
// batch's price since. A leaf module: batchStub.ts (the warehouse's batch reads) and productStub.ts (the owner's batch
// reads) both price their rows from it, so a correction made on one screen shows on the other, through the live reads.
// Reset with the batch stub, in preview's beforeEach.

export interface PriceLog {
  /** The history row's id — the batch_logs row the server writes. */
  id: bigint;
  batchId: bigint;
  warehouseId: bigint;
  productId: bigint;
  from: number;
  to: number;
  units: bigint;
  valueDelta: number;
  reason: string;
  actorUserId: bigint;
  isOverride: boolean;
  atUnix: bigint;
}

export const batchPriceScenario = {
  logs: [] as PriceLog[],
  /** A batch's price now, by batch id — absent until it is corrected. */
  prices: new Map<string, number>(),
  /** Batches a story emptied, by id — their units left read 0. */
  emptied: new Set<string>(),
  /** What BatchRevalue received, for a story to assert. */
  calls: [] as { batchId: bigint; teamId: bigint; expectedPrice: number; newPrice: number; reason: string }[],
};

export function resetBatchPriceScenario() {
  batchPriceScenario.logs = [];
  batchPriceScenario.prices = new Map();
  batchPriceScenario.emptied = new Set();
  batchPriceScenario.calls = [];
}

/** The batch's price now: its last correction, else the price it was minted at. */
export function priceNow(batchId: bigint, minted: number): number {
  return batchPriceScenario.prices.get(batchId.toString()) ?? minted;
}

/** The corrections of one batch, oldest first. */
export function priceLogsOf(batchId: bigint): PriceLog[] {
  return batchPriceScenario.logs.filter((l) => l.batchId === batchId);
}

export function isEmptied(batchId: bigint): boolean {
  return batchPriceScenario.emptied.has(batchId.toString());
}
