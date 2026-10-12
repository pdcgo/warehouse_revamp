import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the create form admits it cannot do yet.
export type TransferFormPendingId = "costEvent";

const PARTS: PendingPart<TransferFormPendingId>[] = [{ id: "costEvent", kind: "missing" }];

export const TRANSFER_FORM_PENDING: PendingList<TransferFormPendingId> = {
  ns: "warehouseTransfer.form",
  parts: PARTS,
};
