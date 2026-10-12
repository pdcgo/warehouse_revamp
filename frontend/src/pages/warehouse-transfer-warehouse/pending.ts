import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the warehouse's transfer list admits it cannot do yet.
export type TransferWarehousePendingId = "labelPhoto";

const PARTS: PendingPart<TransferWarehousePendingId>[] = [{ id: "labelPhoto", kind: "dropped" }];

export const TRANSFER_WAREHOUSE_PENDING: PendingList<TransferWarehousePendingId> = {
  ns: "warehouseTransfer.warehouse",
  parts: PARTS,
};
