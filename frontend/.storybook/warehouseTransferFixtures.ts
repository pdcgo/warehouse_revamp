// The warehouse transfers Storybook serves — one per status, plus the cases worth seeing
// (docs/business/inventory/warehouse_transfer_decision.md). Toko Melati (12) moves its own stock from Gudang Pusat (11)
// to Gudang Cabang (14); one transfer runs the other way, so Gudang Pusat has an INCOMING one too; and Toko Kenanga (13)
// sends one, so a warehouse list carries two owners.
//
// Ani (61) is Toko Melati's; Budi (62) works at Gudang Pusat; Dewi (64) and Eko (65) at Gudang Cabang.
//
// Every id is APPENDED, never reordered — stories reach for these by id through `transferFixture(id)`.

import {
  WarehouseTransferProblemType,
  WarehouseTransferStatus,
} from "../src/gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { daysAgo } from "./fixtures";

const NONE = WarehouseTransferStatus.UNSPECIFIED;
const CREATED = WarehouseTransferStatus.CREATED;
const PROCESS = WarehouseTransferStatus.PROCESS;
const SHIPPED = WarehouseTransferStatus.SHIPPED;
const ARRIVED = WarehouseTransferStatus.ARRIVED;
const ACCEPTED = WarehouseTransferStatus.ACCEPTED;
const CANCELLED = WarehouseTransferStatus.CANCELLED;
const LOST = WarehouseTransferStatus.LOST;
const BROKEN = WarehouseTransferProblemType.BROKEN;
const MISSING = WarehouseTransferProblemType.MISSING;

export interface TransferPlacementFixture {
  placementId: bigint;
  quantity: bigint;
}

export interface TransferLineFixture {
  id: bigint;
  productId: bigint;
  sku: string;
  name: string;
  count: bigint;
  /** The value the out-leg took — exact, from A's batches. */
  total: bigint;
  picks: TransferPlacementFixture[];
  // Filled by the accept.
  arrivedCount: bigint;
  placements: TransferPlacementFixture[];
  problems: { type: WarehouseTransferProblemType; count: bigint; total: bigint; note: string }[];
}

export interface TransferLogFixture {
  id: bigint;
  fromStatus: WarehouseTransferStatus;
  toStatus: WarehouseTransferStatus;
  actorUserId: bigint;
  description: string;
  atUnix: bigint;
}

export interface TransferFixture {
  id: bigint;
  teamId: bigint;
  fromWarehouseId: bigint;
  toWarehouseId: bigint;
  status: WarehouseTransferStatus;
  note: string;
  items: TransferLineFixture[];
  shipmentId: bigint;
  receipt: string;
  receiptFile: string;
  shipmentCost: bigint;
  financeAccountId: bigint;
  warehouseAdditionalCost: bigint;
  warehouseAdditionalCostNote: string;
  outboundTransactionId: bigint;
  inboundTransactionId: bigint;
  createdByUserId: bigint;
  createdAtUnix: bigint;
  processedByUserId: bigint;
  processedAtUnix: bigint;
  shippedByUserId: bigint;
  shippedAtUnix: bigint;
  arrivedByUserId: bigint;
  arrivedAtUnix: bigint;
  acceptedByUserId: bigint;
  acceptedAtUnix: bigint;
  cancelledByUserId: bigint;
  cancelledAtUnix: bigint;
  lostByUserId: bigint;
  lostAtUnix: bigint;
  logs: TransferLogFixture[];
}

const BERAS = { productId: 74n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" };
const KOPI = { productId: 71n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g" };
const TEH = { productId: 72n, sku: "SKU-TEH-100", name: "Teh Melati 100g" };
const GULA = { productId: 73n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg" };

const at = (placementId: bigint, quantity: number): TransferPlacementFixture => ({
  placementId,
  quantity: BigInt(quantity),
});

function line(
  id: number,
  product: { productId: bigint; sku: string; name: string },
  count: number,
  total: number,
  picks: TransferPlacementFixture[],
): TransferLineFixture {
  return {
    id: BigInt(id),
    ...product,
    count: BigInt(count),
    total: BigInt(total),
    picks,
    arrivedCount: 0n,
    placements: [],
    problems: [],
  };
}

function transfer(
  fields: Partial<TransferFixture> & Pick<TransferFixture, "id" | "status" | "items">,
): TransferFixture {
  return {
    teamId: 12n,
    fromWarehouseId: 11n,
    toWarehouseId: 14n,
    note: "",
    shipmentId: 0n,
    receipt: "",
    receiptFile: "",
    shipmentCost: 0n,
    financeAccountId: 0n,
    warehouseAdditionalCost: 0n,
    warehouseAdditionalCostNote: "",
    outboundTransactionId: 0n,
    inboundTransactionId: 0n,
    createdByUserId: 61n,
    createdAtUnix: daysAgo(3),
    processedByUserId: 0n,
    processedAtUnix: 0n,
    shippedByUserId: 0n,
    shippedAtUnix: 0n,
    arrivedByUserId: 0n,
    arrivedAtUnix: 0n,
    acceptedByUserId: 0n,
    acceptedAtUnix: 0n,
    cancelledByUserId: 0n,
    cancelledAtUnix: 0n,
    lostByUserId: 0n,
    lostAtUnix: 0n,
    logs: [],
    ...fields,
  };
}

const log = (
  id: number,
  fromStatus: WarehouseTransferStatus,
  toStatus: WarehouseTransferStatus,
  actorUserId: bigint,
  description: string,
  ago: number,
): TransferLogFixture => ({ id: BigInt(id), fromStatus, toStatus, actorUserId, description, atUnix: daysAgo(ago) });

export const transferFixtures: TransferFixture[] = [
  // CREATED — the stock is already off Gudang Pusat's book (a-transfer-takes-from-the-sender-at-create), waiting on its
  // racks for the picker. Two lines, the Beras split over two racks by the fewest-first rule. No cost typed yet: the
  // courier prices by the packed weight, which nobody knows before A packs.
  transfer({
    id: 601n,
    status: CREATED,
    createdAtUnix: daysAgo(1),
    note: "Stok untuk wilayah timur",
    outboundTransactionId: 9601n,
    items: [
      line(6011, BERAS, 10, 650000, [at(41n, 4), at(42n, 6)]),
      line(6012, KOPI, 6, 240000, [at(43n, 6)]),
    ],
    logs: [log(1, NONE, CREATED, 61n, "", 1)],
  }),

  // PROCESS — Gudang Pusat confirmed and is picking. From here the team cannot cancel.
  transfer({
    id: 602n,
    status: PROCESS,
    createdAtUnix: daysAgo(2),
    outboundTransactionId: 9602n,
    processedByUserId: 62n,
    processedAtUnix: daysAgo(1),
    items: [line(6021, TEH, 12, 180000, [at(41n, 12)])],
    logs: [log(1, NONE, CREATED, 61n, "", 2), log(2, CREATED, PROCESS, 62n, "", 1)],
  }),

  // SHIPPED — with the courier. The team has typed the trip's cost and the account that pays it, and may give the box
  // up as lost. The Beras came off two batches at two prices, so its line total is not count × one price
  // (the-receiver-mints-one-batch-per-source-batch).
  transfer({
    id: 603n,
    status: SHIPPED,
    createdAtUnix: daysAgo(4),
    shipmentId: 91n,
    receipt: "JNE7788990011",
    shipmentCost: 18000n,
    financeAccountId: 1301n,
    outboundTransactionId: 9603n,
    processedByUserId: 62n,
    processedAtUnix: daysAgo(3),
    shippedByUserId: 62n,
    shippedAtUnix: daysAgo(2),
    items: [
      line(6031, BERAS, 5, 328000, [at(42n, 5)]),
      line(6032, KOPI, 4, 160000, [at(43n, 4)]),
    ],
    logs: [
      log(1, NONE, CREATED, 61n, "", 4),
      log(2, CREATED, PROCESS, 62n, "", 3),
      log(3, PROCESS, SHIPPED, 62n, "JNE JNE7788990011", 2),
    ],
  }),

  // ARRIVED — Gudang Cabang signed for the box; it is on its floor, waiting to be counted. Accepted at team 14.
  transfer({
    id: 604n,
    status: ARRIVED,
    createdAtUnix: daysAgo(5),
    shipmentId: 92n,
    receipt: "JNT5544332211",
    shipmentCost: 15000n,
    financeAccountId: 1301n,
    outboundTransactionId: 9604n,
    processedByUserId: 62n,
    processedAtUnix: daysAgo(4),
    shippedByUserId: 62n,
    shippedAtUnix: daysAgo(3),
    arrivedByUserId: 64n,
    arrivedAtUnix: daysAgo(0),
    items: [line(6041, KOPI, 10, 400000, [at(41n, 10)])],
    logs: [
      log(1, NONE, CREATED, 61n, "", 5),
      log(2, CREATED, PROCESS, 62n, "", 4),
      log(3, PROCESS, SHIPPED, 62n, "J&T JNT5544332211", 3),
      log(4, SHIPPED, ARRIVED, 64n, "", 0),
    ],
  }),

  // ACCEPTED, with problems — of 6 Beras sent, 5 arrived and 1 of those was crushed: one BROKEN row, one MISSING row,
  // 4 good units on Gudang Cabang's rack (broken-and-missing-at-the-door-are-problem-rows). The courier asked Rp 5.000
  // at B's door, which B paid and the team owes back (the-on-site-charge-is-paid-by-b-at-accept).
  transfer({
    id: 605n,
    status: ACCEPTED,
    createdAtUnix: daysAgo(9),
    shipmentId: 93n,
    receipt: "SCP2233445566",
    shipmentCost: 20000n,
    financeAccountId: 1301n,
    warehouseAdditionalCost: 5000n,
    warehouseAdditionalCostNote: "Biaya bongkar kurir",
    outboundTransactionId: 9605n,
    inboundTransactionId: 9615n,
    processedByUserId: 62n,
    processedAtUnix: daysAgo(8),
    shippedByUserId: 62n,
    shippedAtUnix: daysAgo(7),
    arrivedByUserId: 64n,
    arrivedAtUnix: daysAgo(5),
    acceptedByUserId: 65n,
    acceptedAtUnix: daysAgo(5),
    items: [
      {
        ...line(6051, BERAS, 6, 390000, [at(41n, 6)]),
        arrivedCount: 5n,
        placements: [at(44n, 4)],
        problems: [
          { type: BROKEN, count: 1n, total: 65000n, note: "Karung sobek" },
          { type: MISSING, count: 1n, total: 65000n, note: "" },
        ],
      },
      {
        ...line(6052, TEH, 10, 150000, [at(42n, 10)]),
        arrivedCount: 10n,
        placements: [at(44n, 6), at(45n, 4)],
      },
    ],
    logs: [
      log(1, NONE, CREATED, 61n, "", 9),
      log(2, CREATED, PROCESS, 62n, "", 8),
      log(3, PROCESS, SHIPPED, 62n, "SiCepat SCP2233445566", 7),
      log(4, SHIPPED, ARRIVED, 64n, "", 5),
      log(5, ARRIVED, ACCEPTED, 65n, "1 broken, 1 missing", 5),
    ],
  }),

  // CANCELLED while created — the units went back on Gudang Pusat's book.
  transfer({
    id: 606n,
    status: CANCELLED,
    createdAtUnix: daysAgo(6),
    outboundTransactionId: 9606n,
    cancelledByUserId: 61n,
    cancelledAtUnix: daysAgo(6),
    items: [line(6061, TEH, 4, 60000, [at(42n, 4)])],
    logs: [log(1, NONE, CREATED, 61n, "", 6), log(2, CREATED, CANCELLED, 61n, "Salah gudang tujuan", 6)],
  }),

  // LOST — shipped, never came. Gudang Cabang can still sign for it if it turns up.
  transfer({
    id: 607n,
    status: LOST,
    createdAtUnix: daysAgo(12),
    shipmentId: 92n,
    receipt: "JNT1122334455",
    shipmentCost: 12000n,
    financeAccountId: 1301n,
    outboundTransactionId: 9607n,
    processedByUserId: 62n,
    processedAtUnix: daysAgo(11),
    shippedByUserId: 62n,
    shippedAtUnix: daysAgo(10),
    lostByUserId: 61n,
    lostAtUnix: daysAgo(2),
    items: [line(6071, KOPI, 3, 120000, [at(43n, 3)])],
    logs: [
      log(1, NONE, CREATED, 61n, "", 12),
      log(2, CREATED, PROCESS, 62n, "", 11),
      log(3, PROCESS, SHIPPED, 62n, "J&T JNT1122334455", 10),
      log(4, SHIPPED, LOST, 61n, "Kurir tidak bisa melacak paketnya", 2),
    ],
  }),

  // THE OTHER WAY — Gudang Cabang back to Gudang Pusat, shipped. Gudang Pusat's INCOMING tab shows it, and the accept
  // story counts it in at team 11, whose racks are 41–43.
  transfer({
    id: 608n,
    status: SHIPPED,
    fromWarehouseId: 14n,
    toWarehouseId: 11n,
    createdAtUnix: daysAgo(3),
    shipmentId: 93n,
    receipt: "SCP9988776655",
    shipmentCost: 10000n,
    financeAccountId: 1301n,
    outboundTransactionId: 9608n,
    processedByUserId: 64n,
    processedAtUnix: daysAgo(2),
    shippedByUserId: 64n,
    shippedAtUnix: daysAgo(1),
    items: [
      line(6081, BERAS, 3, 195000, [at(44n, 3)]),
      line(6082, TEH, 5, 75000, [at(45n, 5)]),
    ],
    logs: [
      log(1, NONE, CREATED, 61n, "", 3),
      log(2, CREATED, PROCESS, 64n, "", 2),
      log(3, PROCESS, SHIPPED, 64n, "SiCepat SCP9988776655", 1),
    ],
  }),

  // ANOTHER OWNER — Toko Kenanga's Gula, leaving Gudang Pusat. A warehouse list holds several teams' transfers; a
  // selling team sees only its own.
  transfer({
    id: 609n,
    status: CREATED,
    teamId: 13n,
    createdByUserId: 66n,
    createdAtUnix: daysAgo(0),
    outboundTransactionId: 9609n,
    items: [line(6091, GULA, 8, 96000, [at(43n, 8)])],
    logs: [log(1, NONE, CREATED, 66n, "", 0)],
  }),
];

export function transferFixture(id: bigint): TransferFixture {
  const found = transferFixtures.find((t) => t.id === id);
  if (!found) throw new Error(`no transfer fixture ${id}`);

  return found;
}
