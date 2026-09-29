import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ORDER DETAIL CANNOT DO YET — one list, the same machinery the order list and the order
// form carry.
//
// This is a PREVIEW of the screen the owner specified: seven sections down one page, rather than the
// three tabs the built detail page has. Most of what the sections need is real — the order, its lines,
// its events, its address. What is missing clusters in three places: the money below the lines, the
// tracking on the shipment, and the whole withdrawal section.
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orderDetail.pending.<id>`). */
export type PendingId =
  | "statusSet"
  | "notes"
  | "productImage"
  | "externalName"
  | "totalFee"
  | "deadline"
  | "receiptCode"
  | "shippingTracking"
  | "returnShipment"
  | "withdrawal"
  | "lifecycle";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE SAME EIGHT-VERSUS-SIX GAP THE LIST HAS. `OrderStatus` is still `placed · confirmed ·
  // picking · packed · shipped · cancelled`, so the four statuses the owner added — completed,
  // problem, lost, return — can never appear here either, and the timeline can never show them.
  { id: "statusSet", kind: "missing" },
  // ⚠ AN ORDER HAS ONE NOTE AND NOBODY CAN CHANGE IT. The owner: *"catatan harusnya bisa diedit,
  // catatan bisa lebih dari 1 dan catatan itu ada tipenya, dari sistem dan dari user"*. `Order.note` is
  // one string written at creation — no list, no author, no type, no edit RPC. Adding and editing work
  // on this screen and vanish on reload: typed and thrown away, which is exactly `dropped`.
  { id: "notes", kind: "dropped" },
  // ⚠ AN ORDER LINE CARRIES NO PICTURE. `OrderItem` is id, product_id, sku, name, quantity,
  // unit_price, unit_cost — and the owner wants the product shown "gambar nama sku".
  //
  // The picture is not missing from the system, only from this message: `Product` has
  // `default_image_url`. So the fix is a per-order-lines lookup (`ProductByIds`) rather than a new
  // field — one batched read for the page, which is why this is `sample` and not `dropped`.
  { id: "productImage", kind: "sample" },
  // ⚠ THE DRAFT KEEPS THE MARKETPLACE'S TITLE AND THE ORDER THROWS IT AWAY. `OrderDraftItem` carries
  // `external_name` + `external_sku` — "never overwritten … the evidence of what the buyer actually
  // ordered" — and `OrderItem` has neither, so promoting a draft discards the one thing anybody can
  // check a mapping against, at the moment the goods start being picked against that mapping.
  //
  // The fix is the two fields on `OrderItem`, copied verbatim at promote. The titles on screen are
  // invented, and only on orders that came from a storefront.
  { id: "externalName", kind: "sample" },
  // ⚠ NOTHING CARRIES THE WAREHOUSE FEE PER ORDER, so "total produk + biaya = total sistem" is a real
  // subtotal plus an invented fee. Same cause and same sample as the list's Beli column: the charge is
  // a liability row keyed by `source_id = order id`, and `LiabilityLogListFilter` takes a counterparty
  // and nothing else (balance Q9).
  { id: "totalFee", kind: "sample" },
  // The ship-by clock. No field anywhere — not on the order, not on the channel.
  { id: "deadline", kind: "sample" },
  // ⚠ THE COURIER IS STORED, THE TRACKING NUMBER IS NOT. `shipping_code` is the carrier (`jne`) and
  // `OrderReceipt` is the attached FILE; the number printed on the slip has no field.
  { id: "receiptCode", kind: "sample" },
  // ⚠ AND THE REST OF THE SHIPMENT IS NOT MODELLED AT ALL — where the parcel is, when the courier
  // scanned it, what it weighed, what the postage cost. The owner expects this section to be EMPTY
  // most of the time ("kebanyakan tidak ada"), which is a design fact worth keeping: the section says
  // "no tracking recorded" rather than hiding, because an absent parcel trail is itself the news.
  //
  // A separate entry from `receiptCode`: that is one missing FIELD, this is a missing INTEGRATION.
  { id: "shippingTracking", kind: "missing" },
  // ⚠ A PARCEL CAN TRAVEL TWICE, AND THE CONTRACT KNOWS ABOUT NEITHER TRIP (owner: *"resi bisa 2 dan
  // jejak pengiriman juga bisa 2, dari order dan return"*). The return leg has its own courier, its own
  // number and its own trail — and there is no return at all today: no status (`statusSet`), no
  // number, no trail. A separate entry from `receiptCode`/`shippingTracking`, which are about the leg
  // that does half-exist; this one is a whole missing record.
  //
  // Invented for order 108 only, so the two-leg shape can be seen populated once.
  { id: "returnShipment", kind: "sample" },
  // ⚠ THE WHOLE SECTION IS UNBACKED, and the owner is undecided about it: *"mungkin sekarang jadi
  // settlement itu, jadi aku masih bingung di sini"*.
  //
  // Withdrawal in the owner's sense is a WALLET → BANK movement: a shop-level cash event that names no
  // order. Settlement's ledger is the opposite — every entry there is required to name one. So the two
  // are not the same thing, and the columns asked for here (tgl import, tgl wd, sumber, nilai, negara
  // lain, deskripsi) have no home in either today. See `docs/technical/order/design_clarify.md`.
  { id: "withdrawal", kind: "missing" },
  // ⚠ AN ORDER'S LIFE ENDS AT "SHIPPED" IN THE CONTRACT. The actions here are the list's table, so
  // they inherit its gap: four of them — Retur Barang, Selesaikan Order, Jadikan Lost, Selesaikan
  // Sengketa — have no RPC to call.
  { id: "lifecycle", kind: "dropped" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDER_DETAIL_PENDING: PendingList<PendingId> = { ns: "orderDetail", parts: PARTS };
