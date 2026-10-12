import type { WarehouseTransfer, WarehouseTransferItem } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import {
  WarehouseTransferProblemType,
  WarehouseTransferStatus,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// The arithmetic every transfer screen reads, in one place so a list row, a detail card and the accept summary can
// never disagree about how many units moved or what they were worth.

/** Units sent — Σ line counts. */
export function unitsSent(items: WarehouseTransferItem[]): bigint {
  return items.reduce((sum, item) => sum + item.count, 0n);
}

function problemCount(item: WarehouseTransferItem, type: WarehouseTransferProblemType): bigint {
  return item.problems.filter((p) => p.type === type).reduce((sum, p) => sum + p.count, 0n);
}

export const brokenOf = (item: WarehouseTransferItem) => problemCount(item, WarehouseTransferProblemType.BROKEN);
export const missingOf = (item: WarehouseTransferItem) => problemCount(item, WarehouseTransferProblemType.MISSING);

/** The units that became B's stock — arrived minus broken. 0 until accepted. */
export function goodOf(item: WarehouseTransferItem): bigint {
  return item.arrivedCount - brokenOf(item);
}

/** Units that did not make it — broken and missing over every line. Only meaningful once accepted. */
export function problemUnits(transfer: WarehouseTransfer): bigint {
  if (transfer.status !== WarehouseTransferStatus.ACCEPTED) return 0n;

  return transfer.items.reduce((sum, item) => sum + brokenOf(item) + missingOf(item), 0n);
}

/** What the broken and missing units were worth — the selling team's loss (the-selling-team-bears-broken-missing-and-lost). */
export function problemValue(transfer: WarehouseTransfer): bigint {
  return transfer.items.reduce((sum, item) => sum + item.problems.reduce((s, p) => s + p.total, 0n), 0n);
}

/** Which way the transfer runs, seen from a warehouse team. */
export function directionFor(transfer: WarehouseTransfer, teamId: bigint): "outgoing" | "incoming" | "none" {
  if (transfer.fromWarehouseId === teamId) return "outgoing";
  if (transfer.toWarehouseId === teamId) return "incoming";

  return "none";
}

/** A route param as a transfer id; 0 for anything that is not a whole number, which no query is sent for. */
export function parseTransferId(raw: string | undefined): bigint {
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}
