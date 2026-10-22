import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the selling team's transfer list admits it cannot do yet: the cost is announced, and nobody posts it.
export type TransferSellingPendingId = "costEvent";

const PARTS: PendingPart<TransferSellingPendingId>[] = [{ id: "costEvent", kind: "missing" }];

export const TRANSFER_SELLING_PENDING: PendingList<TransferSellingPendingId> = {
  ns: "warehouseTransfer.selling",
  parts: PARTS,
};
