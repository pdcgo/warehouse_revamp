import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailExtras, orders } from "./fixtures";
import { orderLabelScenario } from "./sessionScenario";

// CETAK ULANG LABEL, as Storybook's stub keeps it (a-changed-label-asks-the-warehouse-to-reprint,
// the-reprint-label-prototype-is-accepted): the two stamps the server keeps on an order, by order id, unix seconds —
//
//   printedAt  when the print page's Print last put its label in a PDF (`orders.label_printed_at`) — OrderLabels with
//              `record_print`, for every order the answer included; the order page's viewer stamps nothing
//   changedAt  when Edit Resi last changed its number or file (`orders.receipt_changed_at`) — a request that changes
//              nothing stamps nothing
//
// and the server's rule over them (reprintLabelOf). The stub reads them into every order read (`reprint_label`,
// `label_printed_at_unix`), narrows Perlu cetak ulang by them, and refuses the handover of a marked parcel. Reset with the
// order notes (stubTransport `resetOrderNotes`, from preview's beforeEach), so a print or an edit in one story is not in
// the next.
//
// ⚠ ITS OWN MODULE, so a story can seed and read it without importing stubTransport.ts (which `npm run typecheck` would
// then pull in whole).
export const reprintLabelScenario = {
  printedAt: {} as Record<string, bigint>,
  changedAt: {} as Record<string, bigint>,
  /** Every OrderLabels asked WITH record_print — the ids it stamped — so a story pins that the print page records. */
  recorded: [] as bigint[][],
  /** Every OrderLabels asked WITHOUT it — the order page's viewer — so a story pins that viewing records nothing. */
  viewed: [] as bigint[][],
};

/** The steps the mark can show on — where Edit Resi is offered (pending, processed, picked). */
const CARRIES = new Set<OrderStatus>([OrderStatus.PENDING, OrderStatus.PROCESSED, OrderStatus.PICKED]);

/** The server's rule: printed, changed after the print, and still in the building. */
export function reprintLabelOf(orderId: bigint, status: OrderStatus): boolean {
  const printed = reprintLabelScenario.printedAt[orderId.toString()];
  const changed = reprintLabelScenario.changedAt[orderId.toString()];

  return printed !== undefined && changed !== undefined && changed > printed && CARRIES.has(status);
}

/** When the label was last printed on the print page; 0 = never. */
export function labelPrintedAtOf(orderId: bigint): bigint {
  return reprintLabelScenario.printedAt[orderId.toString()] ?? 0n;
}

// One clock for both stamps, always moving forward — a story's print and edit in the same second still read in order.
let lastStamp = 0n;

function stampNow(): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000));
  lastStamp = now > lastStamp ? now : lastStamp + 1n;
  return lastStamp;
}

/** The print page's Print, as the server stamps it: these orders' labels are in the PDF now. */
export function stampPrinted(orderIds: bigint[]) {
  const at = stampNow();
  for (const id of orderIds) reprintLabelScenario.printedAt[id.toString()] = at;
  reprintLabelScenario.recorded.push([...orderIds]);
}

/** Edit Resi, as the server stamps it: this order's number or file changed now. */
export function stampChanged(orderId: bigint) {
  reprintLabelScenario.changedAt[orderId.toString()] = stampNow();
}

/**
 * A `beforeEach`: orders' label events, in hours before now — `printed` the last print, `changed` the last resi or label
 * change (absent = never). Printed 3 h ago and changed 1 h ago marks it; changed before the print, or never printed, does
 * not.
 */
export function withLabelEvents(events: Record<string, { printed?: number; changed?: number }>) {
  return () => {
    const now = Date.now() / 1000;
    for (const [id, { printed, changed }] of Object.entries(events)) {
      if (printed !== undefined) reprintLabelScenario.printedAt[id] = BigInt(Math.floor(now - printed * 3600));
      if (changed !== undefined) reprintLabelScenario.changedAt[id] = BigInt(Math.floor(now - changed * 3600));
    }
  };
}

/** The orders the reprint stories lean on — all Gudang Pusat (11)'s. */
export const REPRINT = {
  /** Dikonfirmasi (processed), Toko Melati — printed 3 h ago, its resi AND label replaced 1 h ago → marked. */
  confirmed: 103n,
  /** Sudah diambil (picked), Toko Melati — printed 5 h ago, its label file replaced 40 min ago → marked. */
  picked: 105n,
  /** Dikonfirmasi — its label replaced 6 h ago, printed 4 h ago: the print took the new label → nothing. */
  changedBeforeThePrint: 104n,
  /** Perlu konfirmasi — its resi replaced 2 h ago, never printed → nothing (the first print takes the new label). */
  neverPrinted: 101n,
  /** Perlu konfirmasi — printed 2 h ago with Konfirmasi setelah dicetak off, never changed → nothing. */
  printedUnchanged: 110n,
} as const;

const resiOf = (id: bigint) => orders.find((o) => o.id === id)!.receiptCode;

/**
 * A `beforeEach` for the reprint stories: the label events above, a label file on every order they print or open (the
 * list's ⋯ Print Label is on, the print page reads it attached), and the seller's Edit Resi note on 103 and 105 — the
 * server's own note text (order_receipt_update.go), a note row from the selling team, so the pick page's Catatan card
 * shows what changed. Returns the restore of the fixtures it wrote.
 */
export function withReprintedOrders(): () => void {
  withLabelEvents({
    [REPRINT.confirmed.toString()]: { printed: 3, changed: 1 },
    [REPRINT.picked.toString()]: { printed: 5, changed: 0.66 },
    [REPRINT.changedBeforeThePrint.toString()]: { printed: 4, changed: 6 },
    [REPRINT.neverPrinted.toString()]: { changed: 2 },
    [REPRINT.printedUnchanged.toString()]: { printed: 2 },
  })();

  orderLabelScenario.labelled = [101n, 102n, 103n, 104n, 105n, 110n, 111n];

  const now = Date.now() / 1000;
  const edits: Record<string, { note: string; at: bigint }> = {
    [REPRINT.confirmed.toString()]: {
      note: `Resi: ${resiOf(REPRINT.confirmed).slice(0, -3)}771 → ${resiOf(REPRINT.confirmed)} · Label: resi-103-lama.pdf → resi-103.pdf`,
      at: BigInt(Math.floor(now - 3600)),
    },
    [REPRINT.picked.toString()]: {
      note: "Label: resi-105-salah.pdf → resi-105.pdf",
      at: BigInt(Math.floor(now - 0.66 * 3600)),
    },
  };

  const before = Object.keys(edits).map((k) => [k, orderDetailExtras[k]] as const);
  for (const [k, { note, at }] of Object.entries(edits)) {
    const row = orders.find((o) => o.id.toString() === k)!;
    const was = orderDetailExtras[k] ?? {};
    const logs = was.timelineLogs ?? [{ id: 1n, status: 1, from: 2, actorId: 61n, createdAtUnix: row.createdAtUnix }];
    orderDetailExtras[k] = {
      ...was,
      receipt: { documentId: `doc-${k}`, filename: `resi-${k}.pdf`, mimeType: "application/pdf" },
      timelineLogs: [...logs, { id: 90n, status: 0, note, from: 2, actorId: 61n, createdAtUnix: at }],
    };
  }

  return () => {
    for (const [k, was] of before) {
      if (was === undefined) delete orderDetailExtras[k];
      else orderDetailExtras[k] = was;
    }
  };
}

export function resetReprintLabels() {
  reprintLabelScenario.printedAt = {};
  reprintLabelScenario.changedAt = {};
  reprintLabelScenario.recorded = [];
  reprintLabelScenario.viewed = [];
  lastStamp = 0n;
}
