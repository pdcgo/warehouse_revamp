import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE PICK PAGE CANNOT DO YET. The item scan (the-item-scans-live-on-the-page) matches each item by its product
// code: products carry no barcode, and the barcode is parked by the owner (design_clarify Q18).

/** One unwired part of the screen. The id is also its i18n key (`picking.pending.<id>`). */
export type PendingId = "barcode";

const PARTS: PendingPart<PendingId>[] = [{ id: "barcode", kind: "derived" }];

export const PICK_ORDER_PENDING: PendingList<PendingId> = { ns: "picking", parts: PARTS };
