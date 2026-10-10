import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the selling team's transfer detail admits it cannot do yet.
export type TransferSellingDetailPendingId = "costEvent";

const PARTS: PendingPart<TransferSellingDetailPendingId>[] = [{ id: "costEvent", kind: "missing" }];

export const TRANSFER_SELLING_DETAIL_PENDING: PendingList<TransferSellingDetailPendingId> = {
  ns: "warehouseTransfer.detail",
  parts: PARTS,
};
