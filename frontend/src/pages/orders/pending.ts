import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is the orders list the owner specified: an export, a per-marketplace import, and four filters. The
// export, the filters — the date filter's seven dates included (the-order-list-filters-by-seven-dates) — every column
// and Edit Resi are real; what is left is the import's reading of each platform's file
// (the-import-moves-only-after-handover). An order carries no withdrawal figure to mark: nobody types one onto an order
// (no-withdrawal-is-typed-on-an-order).
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId = "import";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ READ BY A RULE NOT SETTLED YET. Shopee and TikTok exports are read (the-order-import-is-one-rpc-per-platform), but
  // laid out as the MOCKS in examples/order_samples are — no real export has been tried — and what each platform word
  // means is a draft for the owner's review. Every other marketplace is told "not yet" at step 2. Which moves an order
  // may make is decided (the-import-moves-only-after-handover).
  { id: "import", kind: "derived" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDERS_LIST_PENDING: PendingList<PendingId> = { ns: "orders", parts: PARTS };
