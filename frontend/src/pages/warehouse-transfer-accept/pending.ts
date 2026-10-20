import type { PendingList, PendingPart } from "../../features/pending/registry";

// What the accept admits it cannot do yet. The courier's charge is a real figure B typed and is saved on the transfer;
// the team's debt to B is balance's, posted from Warehouse Transfer Accepted
// (balance-posts-the-transfers-on-site-debt-from-the-event). The event is published; balance does not listen yet, since
// the source type it posts under is open (balance context Q13).
export type TransferAcceptPendingId = "courierDebt";

const PARTS: PendingPart<TransferAcceptPendingId>[] = [{ id: "courierDebt", kind: "missing" }];

export const TRANSFER_ACCEPT_PENDING: PendingList<TransferAcceptPendingId> = {
  ns: "warehouseTransfer.accept",
  parts: PARTS,
};
