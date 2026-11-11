import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT CETAK LABEL CANNOT DO YET. Every label and every count is real; what is not there yet is a way to read several
// restocks at once. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`restock.labels.pending.<id>`). */
export type PendingId = "byIds";

// In the order they sit on the screen — the number on a badge is its position here.
const PARTS: PendingPart<PendingId>[] = [
  // ⚠ EACH RESTOCK IS READ ON ITS OWN (owner: *"restock detail harusnya ada yang dipanggil ids"*, *"kasih
  // unimplemented"*). RestockRequestDetail and RestockRequestLabels take one request id each, and RestockRequestList
  // has no ids filter, so `useLabelSets` asks for every restock separately: 5 restocks are up to 10 calls, 50 up to
  // 100. A read by ids would make it two — and `labelSets.ts` is the one file it changes.
  { id: "byIds", kind: "interim" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_LABELS_PENDING: PendingList<PendingId> = { ns: "restock.labels", parts: PARTS };
