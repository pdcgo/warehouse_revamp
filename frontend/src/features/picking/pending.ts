import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE PICK PAGES CANNOT DO YET (the order pick page and the custom-shipment pick page share the item scan). The item scan (the-item-scans-live-on-the-page) matches each item by its product
// code: products carry no barcode, and the barcode is parked by the owner (design_clarify Q18).

/** One unwired part of the screen. The id is also its i18n key (`picking.pending.<id>`). */
export type PendingId = "barcode";

const PARTS: PendingPart<PendingId>[] = [{ id: "barcode", kind: "derived" }];

export const PICK_ORDER_PENDING: PendingList<PendingId> = { ns: "picking", parts: PARTS };
