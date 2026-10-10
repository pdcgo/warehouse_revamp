import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the warehouse's transfer detail admits it cannot do yet.
export type TransferWarehouseDetailPendingId = "labelPhoto";

const PARTS: PendingPart<TransferWarehouseDetailPendingId>[] = [{ id: "labelPhoto", kind: "dropped" }];

export const TRANSFER_WAREHOUSE_DETAIL_PENDING: PendingList<TransferWarehouseDetailPendingId> = {
  ns: "warehouseTransfer.warehouseDetail",
  parts: PARTS,
};
