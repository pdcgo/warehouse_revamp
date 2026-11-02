import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RESTOCK LIST CANNOT DO YET. The list itself is real; its export, its courier filter and its statistics are
// not. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`restock.selling.pending.<id>`). */
export type PendingId = "export" | "courier" | "summary" | "payments" | "cancelReview";

// In the order they sit on the screen — the number on a badge is its position here.
const PARTS: PendingPart<PendingId>[] = [
  // ⚠ NOTHING MAKES A RESTOCK FILE. The order list exports through its own server stream (OrderExport); restock has no
  // such RPC. The button is there and the click is THROWN AWAY — it says so in a toast.
  { id: "export", kind: "dropped" },
  // ⚠ THE LIST CANNOT ASK FOR A COURIER. `RestockRequestListFilter` has no shipment channel, so the pick is held in the
  // URL and the rows do not move.
  { id: "courier", kind: "dropped" },
  // ⚠ NOTHING COUNTS A TEAM'S RESTOCKS BY STATUS. The list pages its rows, and OwnerStockStat says only what is in
  // flight. Every card's figure is a SAMPLE (summarySample.ts), steady per team, and it does not follow the filters.
  { id: "summary", kind: "sample" },
  // ⚠ THE PAYING ACCOUNT IS ON EVERY RESTOCK, THE SUM PER ACCOUNT IS NOT. The accounts are the team's real operational
  // ones; how the value splits over them is invented.
  { id: "payments", kind: "sample" },
  // ⚠ NOTHING CHECKS A CANCELLATION. The cancel dialog warns that it will be (owner: *"taruh di unimplemented juga khusus
  // ini"*, a-restock-cancel-warns-it-will-be-checked); no screen, queue or record does it — the check is MISSING.
  { id: "cancelReview", kind: "missing" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_SELLING_PENDING: PendingList<PendingId> = { ns: "restock.selling", parts: PARTS };
