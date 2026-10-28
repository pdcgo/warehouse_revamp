import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is the orders list the owner specified: an export, a per-marketplace import, and four filters. The
// export, the filters and every column are real; what is left is the import's file, waiting on a decision
// (technical order Q19), and Edit Resi's RPC. An order carries no withdrawal figure to mark: nobody types one onto an order
// (no-withdrawal-is-typed-on-an-order).
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId = "import" | "receiptCode";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE FILE IS READ BY NOTHING. The dialog takes a marketplace and a file and stops there: no
  // upload, no parse, no status written back. Each marketplace prints a different sheet, so the
  // PARSER is per-marketplace too — that is the work behind this entry, not the button. Which
  // marketplace status maps to which of ours is not decided either (the-order-import-moves-statuses-only).
  { id: "import", kind: "dropped" },
  // ⚠ EDIT RESI IS ON SCREEN AND DOES NOTHING. Decided (the-seller-edits-the-resi-until-handover): the selling team
  // changes the tracking number, the label file or both, while the parcel is still in the building. There is no edit
  // RPC yet, so the action only says so. `rowActions.ts` points EDIT_RECEIPT here — the id must be in this list, or the
  // badge reads a position that does not exist.
  { id: "receiptCode", kind: "missing" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDERS_LIST_PENDING: PendingList<PendingId> = { ns: "orders", parts: PARTS };
