import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is the orders list the owner specified: an export, a per-marketplace import, and four filters. The
// export, the filters, every column and Edit Resi are real; what is left is the import's file
// (the-import-moves-only-after-handover) and five of the date filter's seven dates. An order carries no withdrawal figure to mark: nobody types one onto an order
// (no-withdrawal-is-typed-on-an-order).
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId = "import" | "dateType";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE FILE IS READ BY NOTHING. The dialog takes a marketplace and a file and stops there: no
  // upload, no parse, no status written back. Each marketplace prints a different sheet, so the
  // PARSER is per-marketplace too — that is the work behind this entry, not the button. Which moves a row may make
  // is decided (the-import-moves-only-after-handover); each marketplace's own words wait on its export file.
  { id: "import", kind: "dropped" },
  // ⚠ THE DATE FILTER OFFERS SEVEN DATES AND CAN ASK ABOUT TWO (`the-order-list-filters-by-seven-dates`). `OrderListFilter`
  // reads Dibuat or Tanggal order (`date_field`, the-date-filter-switches-created-or-platform); the five status dates —
  // Diproses, Sudah diambil, Sudah diserahkan, Selesai, Retur — need the filter to read the timeline, so picking one sends
  // NO window at all: the list is honestly unnarrowed rather than narrowed by the wrong date.
  { id: "dateType", kind: "dropped" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDERS_LIST_PENDING: PendingList<PendingId> = { ns: "orders", parts: PARTS };
