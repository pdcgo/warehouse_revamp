import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is the orders list the owner specified: an export, a per-marketplace import, and four filters. The
// export, the filters and every column are real; what is left is the import's file and the withdrawal figure,
// both waiting on a decision (technical order Q19 and Q20).
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId = "import" | "withdrawal";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE FILE IS READ BY NOTHING. The dialog takes a marketplace and a file and stops there: no
  // upload, no parse, no status written back. Each marketplace prints a different sheet, so the
  // PARSER is per-marketplace too — that is the work behind this entry, not the button. Which
  // marketplace status maps to which of ours is not decided either (the-order-import-moves-statuses-only).
  { id: "import", kind: "dropped" },
  // ⚠ AN ORDER STILL HAS NO WITHDRAWAL FIGURE — the mark on a completed order's Edit Withdrawal.
  //
  // A withdrawal is WALLET → BANK, a shop-level cash event that names no order, and Settlement Imports now
  // records it on the shop (withdrawal-is-a-settlement-type). The order list's Import no longer promises it
  // (the-order-import-moves-statuses-only), so this entry backs only the row action — and
  // finish-order-on-a-return-waits-for-the-withdrawal, which waits on the same per-order figure.
  { id: "withdrawal", kind: "missing" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDERS_LIST_PENDING: PendingList<PendingId> = { ns: "orders", parts: PARTS };
