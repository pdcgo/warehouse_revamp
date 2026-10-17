import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the selling team's transfer list admits it cannot do yet. The whole service is a prototype — the real server
// answers Unimplemented — and the marks name what even the Storybook version leaves out.
export type TransferSellingPendingId = "costEvent";

const PARTS: PendingPart<TransferSellingPendingId>[] = [{ id: "costEvent", kind: "missing" }];

export const TRANSFER_SELLING_PENDING: PendingList<TransferSellingPendingId> = {
  ns: "warehouseTransfer.selling",
  parts: PARTS,
};
