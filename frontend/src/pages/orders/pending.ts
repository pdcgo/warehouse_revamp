import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is a PREVIEW of the orders list the owner specified: an export, a per-marketplace import, and
// four filters. Three of the six things it adds have nothing behind them — `OrderListFilter` has no
// warehouse field, so that picker narrows the list by exactly nothing; and there is no RPC on either
// side of a file. The marketplace filter is real (the-filter-gains-seller-marketplace-and-courier).
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId =
  | "summaryCost"
  | "summaryItems"
  | "import"
  | "warehouseFilter"
  | "mpDate"
  | "stageDate"
  | "dateType"
  | "receiptCode"
  | "deadline"
  | "totalFee"
  | "withdrawal";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ TWO MARKS FOR SEVEN COLUMNS, because there are two CAUSES and the reader only needs to know
  // each once (HARD RULE 11: group by cause, not by symptom).
  //
  // `OrderStatusCount` sums `total` and nothing else, so the goods' value, the cost and the count of
  // orders with no cost recorded are all absent together. `tx`, `nilai transaksi` and `ATV` are real
  // — they come off the census the server already sends — so the mark sits on the money columns
  // rather than on the whole strip.
  { id: "summaryCost", kind: "sample" },
  // The list deliberately returns no lines (`OrderList` leaves `items` empty), and nothing counts
  // them server-side. The sibling message already solved this — `OrderDraft.item_count`, computed on
  // every read for exactly this reason — so the fix is a known shape, not an open question.
  { id: "summaryItems", kind: "sample" },
  // ⚠ THE FILE IS READ BY NOTHING. The dialog takes a marketplace and a file and stops there: no
  // upload, no parse, no status written back. Each marketplace prints a different sheet, so the
  // PARSER is per-marketplace too — that is the work behind this entry, not the button.
  { id: "import", kind: "dropped" },
  // `OrderListFilter` has no warehouse field. The orders list is already read from both ends (#151) —
  // a warehouse sees what ships from it — so the value exists on the order; what is missing is a way
  // for a SELLING team to ask "only the ones leaving Gudang Pusat".
  { id: "warehouseFilter", kind: "dropped" },
  // ⚠ THE MARKETPLACE'S OWN ORDER DATE HAS NO FIELD. `created_at_unix` is when WE wrote the row; an
  // order taken on Saturday and typed in on Monday has two dates and the contract carries one. (Who typed
  // it in — the cell's other line — is a real field now, `created_by_user_id`.)
  { id: "mpDate", kind: "sample" },
  // ⚠ THE SHAPE EXISTS AND THE LIST CANNOT READ IT. `OrderTimelineLog` is already `status` + `created_at_unix`,
  // which is exactly "when did it enter this status" — but the timeline is populated by `OrderDetail` only, so
  // the fix here is not a new field, it is the list carrying the one row the filter asks about.
  { id: "stageDate", kind: "sample" },
  // ⚠ THE DATE FILTER OFFERS SEVEN DATES AND CAN ASK ABOUT ONE (`the-order-list-filters-by-seven-dates`). `OrderListFilter`'s
  // window is `created_at` and nothing else, so picking Tanggal order or a status date sends NO window at all — the list
  // is honestly unnarrowed rather than narrowed by the wrong date. One cause, so one entry for the six marked pills: the
  // order date needs a field (`mpDate`), the status dates need the filter to read the timeline (`stageDate`).
  { id: "dateType", kind: "dropped" },
  // ⚠ THE COURIER IS STORED, THE TRACKING NUMBER IS NOT. `shipping_code` is the CARRIER (`jne`) and
  // `OrderReceipt` is the attached FILE — there is no field for the number printed on the slip,
  // which is the one thing a buyer chases an order by.
  //
  // ⚠ AND THE ONE ON SCREEN IS INVENTED (`rowMock`). It has a real courier's shape, so it is
  // copy-pasteable into a tracking site where it will not be found — the loudest reason this mark
  // has to stay until the field lands.
  { id: "receiptCode", kind: "sample" },
  // ⚠ THE HEADLINE TOTAL IS A REAL `subtotal` PLUS AN INVENTED FEE — and it is deliberately NOT
  // `Order.total`. The owner's total is the goods plus what fulfilling them costs ("harga produk +
  // biaya, misal gudang"); `Order.total` is `subtotal + shipping_cost`, and the ONGKIR IS THE
  // WAREHOUSE'S TO SET, not the seller's, so it answers a different question.
  //
  // The fee is recorded — a liability ledger row keyed by `source_id = order id` — and unreadable:
  // `LiabilityLogListFilter` takes a counterparty and nothing else (balance Q9). So the honest
  // options were a real number answering the wrong question, or the right question with a sampled
  // half and a mark. This is the second.
  // ⚠ NOTHING CARRIES A SHIP-BY DATE. Not `Order`, not `ShipmentChannel` (no lead time), and not
  // `OrderTimelineLog`, which records what HAPPENED rather than what is due. The real thing it stands in for
  // is the marketplace's own ship-by clock, which is per storefront — so the field it needs is a
  // deadline ON the order, written when the order is imported.
  //
  // ⚠ AND THE COLOUR BANDS ARE A GUESS TOO: 6 hours as "not for the next shift", 24 as "today's
  // problem". Both are the owner's to set; they are named in one place (`deadlineMock`) for that.
  { id: "deadline", kind: "sample" },
  { id: "totalFee", kind: "sample" },
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
