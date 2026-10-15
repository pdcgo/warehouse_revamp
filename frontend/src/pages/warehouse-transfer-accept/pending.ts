import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the accept admits it cannot do yet. The courier's charge is a real figure B typed and is saved on the transfer;
// the team's debt to B is balance's, posted from Warehouse Transfer Accepted
// (balance-posts-the-transfers-on-site-debt-from-the-event) — and that event waits for the events pass, so balance does
// not hear of it yet.
export type TransferAcceptPendingId = "courierDebt";

const PARTS: PendingPart<TransferAcceptPendingId>[] = [{ id: "courierDebt", kind: "missing" }];

export const TRANSFER_ACCEPT_PENDING: PendingList<TransferAcceptPendingId> = {
  ns: "warehouseTransfer.accept",
  parts: PARTS,
};
