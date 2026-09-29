import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET — in ONE list, the same way the order form carries its own.
//
// This is a PREVIEW of the orders list the owner specified: an export, a per-marketplace import, and
// four filters. Five of the six things it adds have nothing behind them — `OrderListFilter` carries a
// status, a product, a search term, a shop and a date window, and NOTHING ELSE, so three of the new
// pickers narrow the list by exactly nothing; and there is no RPC on either side of a file.
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orders.pending.<id>`). */
export type PendingId =
  | "statusSet"
  | "summaryCost"
  | "summaryItems"
  | "export"
  | "import"
  | "warehouseFilter"
  | "creator"
  | "mpDate"
  | "stageDate"
  | "receiptCode"
  | "deadline"
  | "totalFee"
  | "lifecycle"
  | "marketplaceFilter"
  | "withdrawal";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE STATUS SET IS THE OWNER'S EIGHT, THE CONTRACT STILL CARRIES THE OLD SIX. One mark, not
  // five, because there is one cause: `OrderStatus` is `placed · confirmed · picking · packed ·
  // shipped · cancelled`, which the owner's own clarify already records as stale and awaiting a
  // migration. What that costs on this screen:
  //
  //   completed · problem · lost · return  → no enum value exists, so those four tabs read 0 forever
  //   processed                            → covers THREE enum values, and `OrderListFilter.status`
  //                                          takes one, so it counts but cannot narrow the table
  //
  // `pending` and `cancel` are renames of `placed` and `cancelled` and cost nothing.
  { id: "statusSet", kind: "missing" },
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
  // Nothing builds a file. The button is here so the ACTION has a place on the screen and a shape to
  // argue about — which columns, which rows (this page, or every row the filters match?).
  { id: "export", kind: "dropped" },
  // ⚠ THE FILE IS READ BY NOTHING. The dialog takes a marketplace and a file and stops there: no
  // upload, no parse, no status written back. Each marketplace prints a different sheet, so the
  // PARSER is per-marketplace too — that is the work behind this entry, not the button.
  { id: "import", kind: "dropped" },
  // `OrderListFilter` has no warehouse field. The orders list is already read from both ends (#151) —
  // a warehouse sees what ships from it — so the value exists on the order; what is missing is a way
  // for a SELLING team to ask "only the ones leaving Gudang Pusat".
  { id: "warehouseFilter", kind: "dropped" },
  // ⚠ AN ORDER HAS NO CREATOR AT ALL. Not a missing filter — a missing FACT: `Order` carries no user
  // id for whoever typed it. ONE entry for BOTH symptoms (HARD RULE 11: group by cause).
  //
  // `sample` rather than `dropped`, now that the name is mocked: a filter that narrows nothing is
  // annoying and instantly visible, while a NAME on screen that nobody actually typed is something a
  // reader would act on — "ask Ani about this one". The worse half names the kind.
  { id: "creator", kind: "sample" },
  // ⚠ THE MARKETPLACE'S OWN ORDER DATE HAS NO FIELD. `created_at_unix` is when WE wrote the row; an
  // order taken on Saturday and typed in on Monday has two dates and the contract carries one. A
  // separate entry from `creator` because it is a separate missing field with a separate fix —
  // grouping them would be grouping by the CELL they share, not by cause.
  { id: "mpDate", kind: "sample" },
  // ⚠ THE SHAPE EXISTS AND THE LIST CANNOT READ IT. `OrderEvent` is already `kind` + `at_unix`, which
  // is exactly "when did it enter this status" — but events are populated by `OrderDetail` only, so
  // the fix here is not a new field, it is the list carrying the one event the filter asks about.
  { id: "stageDate", kind: "sample" },
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
  // `OrderEvent`, which records what HAPPENED rather than what is due. The real thing it stands in for
  // is the marketplace's own ship-by clock, which is per storefront — so the field it needs is a
  // deadline ON the order, written when the order is imported.
  //
  // ⚠ AND THE COLOUR BANDS ARE A GUESS TOO: 6 hours as "not for the next shift", 24 as "today's
  // problem". Both are the owner's to set; they are named in one place (`deadlineMock`) for that.
  { id: "deadline", kind: "sample" },
  { id: "totalFee", kind: "sample" },
  // Derivable rather than stored: a shop belongs to exactly one marketplace, so this is "every shop
  // on Shopee". The filter is not on the wire either way.
  // ⚠ AN ORDER'S LIFE ENDS AT "SHIPPED" IN THE CONTRACT. `OrderService` writes exactly two things a
  // seller can reach — `OrderCancel` and `OrderShip` (plus the warehouse's confirm/pick/pack) — so
  // FOUR of the owner's row actions have no RPC to call: Retur Barang, Selesaikan Order, Jadikan
  // Lost and Selesaikan Sengketa.
  //
  // ONE entry for all four (HARD RULE 11: group by cause). They are not four oversights; they are
  // one half of the lifecycle that has not been designed — the same half whose four STATUSES read 0
  // forever under `statusSet`. The tabs and the menu items are the same gap seen from two angles.
  //
  // `dropped` rather than `missing`: the items are ON the menu and can be pressed. Each one answers
  // with a toast carrying this sentence, which is the least dishonest thing a button with nothing
  // behind it can do.
  { id: "lifecycle", kind: "dropped" },
  { id: "marketplaceFilter", kind: "dropped" },
  // ⚠ WHAT THE IMPORT IS FOR, and it has nowhere to land — nor anywhere to land NEXT to.
  //
  // The owner settled which sense this is: a WALLET → BANK withdrawal, a shop-level cash event that
  // names no order. That is not settlement's `fund` (money the platform released against one order,
  // which does exist), and settlement cannot take it either — every entry there is required to name
  // an order. It is an open question in two places at once; see
  // `docs/technical/order/design_clarify.md`.
  { id: "withdrawal", kind: "missing" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDERS_LIST_PENDING: PendingList<PendingId> = { ns: "orders", parts: PARTS };
