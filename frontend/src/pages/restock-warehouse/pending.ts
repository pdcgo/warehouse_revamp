import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S RESTOCK LIST CANNOT DO YET. The queue, its figures and its rows are real; the COD it paid is not
// summed by anything, and the COD noted when a box is signed for is not kept. The list shrinks by one entry each time
// something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`restock.inbound.pending.<id>`). */
export type PendingId = "cod" | "arrivalCod";

// In the order they sit on the screen — the number on a badge is its position here.
const PARTS: PendingPart<PendingId>[] = [
  // ⚠ NOTHING SUMS THE COURIER'S CHARGE THE WAREHOUSE PAID. Each restock stores it (`warehouse_additional_cost`, entered
  // at accept), but no read totals it over a month — RestockInboundPreview counts the queue still to do, and the list
  // pages its rows. The card's figure is a SAMPLE (codSample.ts), steady per warehouse.
  { id: "cod", kind: "sample" },
  // ⚠ THE CHARGE NOTED AT TANDAI TIBA IS THROWN AWAY (the-cod-can-be-noted-when-the-box-arrives): RestockRequestArrive
  // takes no charge. The row's sign dialog has the fields; a toast after the sign says to enter it again at Terima. And it
  // goes AGAINST the business decision the-warehouse-cost-is-the-couriers-charge-at-the-door (entered at accept).
  { id: "arrivalCod", kind: "dropped", conflict: true },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_INBOUND_PENDING: PendingList<PendingId> = { ns: "restock.inbound", parts: PARTS };
