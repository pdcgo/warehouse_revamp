import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { mockCreator } from "../orders/rowMock";

// AN ORDER'S NOTES — several, and of two kinds (owner: *"catatan harusnya bisa diedit, catatan bisa
// lebih dari 1 dan catatan itu ada tipenya, dari sistem dan dari user"*).
//
//   user    written by a person — an instruction to the packers, a buyer's request. Editable.
//   system  written by the app — a record of something that happened. Never editable: rewriting it
//           would be rewriting history.
//
// ⚠ THE CONTRACT HAS ONE STRING. `Order.note` is written once at creation, with no author, no type, no
// list and no way to edit it. So this file invents the list, and the one real string becomes its first
// user note — authored by whoever created the order, since that is who typed it on the form.
//
// ⚠ DELETE THIS FILE the day notes have a source. Derived from the order id, never random.

export type NoteKind = "system" | "user";

export interface OrderNote {
  id: string;
  kind: NoteKind;
  /** A person's name. Absent on a system note — the app is not an author. */
  author?: string;
  at: bigint;
  text: string;
}

const MINUTE = 60n;

export function mockNotes(order: {
  id: bigint;
  status: OrderStatus;
  note: string;
  createdAtUnix: bigint;
  orderExternalRefId: string;
}): OrderNote[] {
  const created = order.createdAtUnix;
  const notes: OrderNote[] = [];

  // The one real string, as what it always was: a person's note written with the order.
  if (order.note.trim()) {
    notes.push({
      id: `${order.id}-form`,
      kind: "user",
      author: mockCreator(order.id),
      at: created,
      text: order.note.trim(),
    });
  }

  // A system record for an order that came in through a scrape, because that is a fact worth keeping
  // beside it: the mapping on this order was made by a person on the draft.
  if (order.orderExternalRefId.trim()) {
    notes.push({
      id: `${order.id}-draft`,
      kind: "system",
      at: created + 2n * MINUTE,
      text: "Pesanan dibuat dari draft marketplace; semua baris sudah dipetakan ke produk.",
    });
  }

  if (order.status === OrderStatus.SHIPPED) {
    notes.push({
      id: `${order.id}-label`,
      kind: "system",
      at: created + 25n * 60n * MINUTE,
      text: "Label pengiriman dicetak; resi diambil dari marketplace.",
    });
  }

  // A later request from a person, on the orders that are still being worked — so the list shows a user
  // note NEWER than a system one, and the ordering is visible.
  if (order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED) {
    notes.push({
      id: `${order.id}-cs`,
      kind: "user",
      author: mockCreator(order.id + 1n),
      at: created + 40n * MINUTE,
      text: "Pembeli minta dikirim sebelum jam 3 sore.",
    });
  }

  // The returned fixture carries the return as a system record.
  if (order.id === 108n) {
    notes.push({
      id: `${order.id}-return`,
      kind: "system",
      at: created + 11n * 24n * 60n * MINUTE,
      text: "Paket retur diterima gudang; 1 item kembali ke stok.",
    });
  }

  return notes;
}
