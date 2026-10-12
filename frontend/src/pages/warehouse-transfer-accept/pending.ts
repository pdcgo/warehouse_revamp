import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the accept admits it cannot do yet. The courier's charge is a real figure B typed; WHERE the team's debt to B is
// held is not decided — the same open point as the restock's courier debt
// (the-couriers-debt-is-written-in-the-accept), answered once for both.
export type TransferAcceptPendingId = "courierDebt";

const PARTS: PendingPart<TransferAcceptPendingId>[] = [{ id: "courierDebt", kind: "derived" }];

export const TRANSFER_ACCEPT_PENDING: PendingList<TransferAcceptPendingId> = {
  ns: "warehouseTransfer.accept",
  parts: PARTS,
};
