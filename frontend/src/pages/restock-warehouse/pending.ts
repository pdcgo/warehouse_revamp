import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S INBOUND LIST CANNOT DO YET. The contract was rewritten to the decided design
// (the-restock-contract-changes-in-place), but the backend lags it until the backend step: the courier is accepted but
// not stored, and signing for the box answers Unimplemented. In Storybook the stub plays both. See `features/pending`
// for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`restock.inbound.pending.<id>`). */
export type RestockWarehousePendingId = "courier" | "signForBox";

const PARTS: PendingPart<RestockWarehousePendingId>[] = [
  // the-receipt-is-the-tracking-number — the courier is `shipment_id`; not stored.
  { id: "courier", kind: "dropped" },
  // the-warehouse-signs-and-accepts-the-team-does-the-rest — RestockRequestArrive answers Unimplemented.
  { id: "signForBox", kind: "dropped" },
];

export const RESTOCK_WAREHOUSE_PENDING: PendingList<RestockWarehousePendingId> = {
  ns: "restock.inbound",
  parts: PARTS,
};
