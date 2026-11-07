import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RACK LIST CANNOT DO YET. The racks, their counts and the number of racks are real; what is not there is a
// read that sums EVERY rack's stock. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`racks.pending.<id>`). */
export type RacksPendingId = "pageTotals";

// In the order they sit on the screen — the number on a badge is its position here.
const PARTS: PendingPart<RacksPendingId>[] = [
  // ⚠ TERISI, KOSONG AND TOTAL STOK ARE THE PAGE'S (the-rack-list-leads-with-its-figures). RackList's STOCK slice answers
  // for the racks on the page it serves; nothing sums every rack. While the racks fit one page the three are exact and
  // nothing is marked; past it the racks on other pages are not in them — `missing`, a total short because of it.
  { id: "pageTotals", kind: "missing" },
];

/** What the badges and the summary read — the part only while the figures cover fewer racks than there are. */
export function racksPending(partial: boolean): PendingList<RacksPendingId> {
  return { ns: "racks", parts: partial ? PARTS : [] };
}
