// The restocks Storybook serves — one per status, and the cases each decision is worth seeing on
// (docs/business/inventory/restock_decision.md). Toko Melati (12) restocks into Gudang Pusat (11); Toko Kenanga (13)
// sends one too, so the warehouse's inbound list has two senders.
//
// Every id is APPENDED, never reordered — stories reach for these by id through `restockFixture(id)`.

import {
  RestockProblemType,
  RestockRequestStatus,
} from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { daysAgo } from "./fixtures";

const ONGOING = RestockRequestStatus.ONGOING;
const ARRIVED = RestockRequestStatus.ARRIVED;
const ACCEPTED = RestockRequestStatus.ACCEPTED;
const LOST = RestockRequestStatus.LOST;
const CANCELLED = RestockRequestStatus.CANCELLED;
const NONE = RestockRequestStatus.UNSPECIFIED;

export interface LineFixture {
  id: bigint;
  productId: bigint;
  sku: string;
  name: string;
  count: bigint;
  total: bigint;
  supplierId: bigint;
  supplierChannelId: bigint;
  note: string;
  // Filled by the accept.
  receivedCount: bigint;
  problems: { type: RestockProblemType; count: bigint; note: string }[];
  placements: { placementId: bigint; quantity: bigint }[];
}

export interface LogFixture {
  id: bigint;
  fromStatus: RestockRequestStatus;
  toStatus: RestockRequestStatus;
  actorUserId: bigint;
  description: string;
  atUnix: bigint;
}

export interface RestockFixture {
  id: bigint;
  requestingTeamId: bigint;
  warehouseId: bigint;
  status: RestockRequestStatus;
  createdAtUnix: bigint;
  items: LineFixture[];
  receipt: string;
  receiptFile: string;
  shipmentId: bigint;
  invoiceRefId: string;
  financeAccountId: bigint;
  shipmentCost: bigint;
  warehouseAdditionalCost: bigint;
  warehouseAdditionalCostNote: string;
  note: string;
  transactionId: bigint;
  createdByUserId: bigint;
  arrivedByUserId: bigint;
  acceptedByUserId: bigint;
  lostByUserId: bigint;
  cancelledByUserId: bigint;
  arrivedAtUnix: bigint;
  acceptedAtUnix: bigint;
  lostAtUnix: bigint;
  cancelledAtUnix: bigint;
  logs: LogFixture[];
}

function line(
  id: number,
  productId: bigint,
  sku: string,
  name: string,
  count: number,
  total: number,
  supplier: { supplierId?: bigint; supplierChannelId?: bigint; note?: string } = {},
): LineFixture {
  return {
    id: BigInt(id),
    productId,
    sku,
    name,
    count: BigInt(count),
    total: BigInt(total),
    supplierId: supplier.supplierId ?? 0n,
    supplierChannelId: supplier.supplierChannelId ?? 0n,
    note: supplier.note ?? "",
    receivedCount: 0n,
    problems: [],
    placements: [],
  };
}

function restock(fields: Partial<RestockFixture> & Pick<RestockFixture, "id" | "status" | "items">): RestockFixture {
  return {
    requestingTeamId: 12n,
    warehouseId: 11n,
    createdAtUnix: daysAgo(3),
    receipt: "",
    receiptFile: "",
    shipmentId: 0n,
    invoiceRefId: "",
    financeAccountId: 1301n,
    shipmentCost: 0n,
    warehouseAdditionalCost: 0n,
    warehouseAdditionalCostNote: "",
    note: "",
    transactionId: 0n,
    createdByUserId: 61n,
    arrivedByUserId: 0n,
    acceptedByUserId: 0n,
    lostByUserId: 0n,
    cancelledByUserId: 0n,
    arrivedAtUnix: 0n,
    acceptedAtUnix: 0n,
    lostAtUnix: 0n,
    cancelledAtUnix: 0n,
    logs: [],
    ...fields,
  };
}

const log = (
  id: number,
  fromStatus: RestockRequestStatus,
  toStatus: RestockRequestStatus,
  actorUserId: bigint,
  description: string,
  ago: number,
): LogFixture => ({ id: BigInt(id), fromStatus, toStatus, actorUserId, description, atUnix: daysAgo(ago) });

export const restockFixtures: RestockFixture[] = [
  // ON ITS WAY — everything editable. One line from a Shopee store, one from a market stall with no store
  // (a-line-may-name-a-supplier-without-a-channel), one not yet connected to any supplier.
  restock({
    id: 501n,
    status: ONGOING,
    createdAtUnix: daysAgo(2),
    receipt: "JNE0123456789",
    shipmentId: 91n,
    invoiceRefId: "INV/2026/10/1001",
    shipmentCost: 20000n,
    note: "Untuk promo 10.10",
    items: [
      line(5011, 74n, "SKU-BERAS-5K", "Beras Pandan Wangi 5kg", 10, 650000, { supplierId: 31n, supplierChannelId: 311n }),
      line(5012, 71n, "SKU-KOPI-250", "Kopi Arabika 250g", 24, 960000, { supplierId: 33n }),
      line(5013, 72n, "SKU-TEH-100", "Teh Melati 100g", 30, 450000),
    ],
    logs: [log(1, NONE, ONGOING, 61n, "created", 2)],
  }),

  // AT THE DOOR — signed for, not yet counted. The box held 12 coffee against 10 ordered, so the
  // selling team edited the line and said why (extra-units-are-added-by-the-selling-teams-edit) — the edit is a row
  // in the same trail (edits-are-in-the-same-trail).
  restock({
    id: 502n,
    status: ARRIVED,
    createdAtUnix: daysAgo(4),
    receipt: "JNT9988776655",
    shipmentId: 92n,
    invoiceRefId: "INV/2026/10/0987",
    shipmentCost: 15000n,
    arrivedByUserId: 62n,
    arrivedAtUnix: daysAgo(1),
    items: [
      line(5021, 71n, "SKU-KOPI-250", "Kopi Arabika 250g", 12, 400000, {
        supplierId: 32n,
        supplierChannelId: 321n,
        note: "extra stock — 2 bonus dari supplier",
      }),
      line(5022, 74n, "SKU-BERAS-5K", "Beras Pandan Wangi 5kg", 5, 325000, { supplierId: 32n, supplierChannelId: 321n }),
    ],
    logs: [
      log(1, NONE, ONGOING, 61n, "created", 4),
      log(2, ONGOING, ARRIVED, 62n, "signed for the box", 1),
      log(3, ARRIVED, ARRIVED, 61n, "Kopi Arabika 250g 10 → 12, extra stock — 2 bonus dari supplier", 1),
    ],
  }),

  // COUNTED IN — 2 broken, 1 missing, the courier asked Rp 5.000 at the door. The total stays goods + shipping
  // (the-couriers-charge-stays-out-of-total); the broken and missing rows are priced by the system
  // (the-problem-price-is-filled-by-the-system), with the warehouse's notes on them (three-notes-one-writer-each).
  restock({
    id: 503n,
    status: ACCEPTED,
    createdAtUnix: daysAgo(9),
    receipt: "SCP5544332211",
    receiptFile: "https://example.test/labels/scp5544332211.jpg",
    shipmentId: 93n,
    invoiceRefId: "INV/2026/09/0412",
    shipmentCost: 30000n,
    warehouseAdditionalCost: 5000n,
    warehouseAdditionalCostNote: "Ongkos bongkar di gudang",
    note: "Stok bulanan",
    transactionId: 9001n,
    arrivedByUserId: 62n,
    acceptedByUserId: 62n,
    arrivedAtUnix: daysAgo(6),
    acceptedAtUnix: daysAgo(6),
    items: [
      {
        ...line(5031, 74n, "SKU-BERAS-5K", "Beras Pandan Wangi 5kg", 10, 650000, { supplierId: 31n, supplierChannelId: 312n }),
        receivedCount: 9n,
        problems: [
          { type: RestockProblemType.BROKEN, count: 2n, note: "Karung sobek" },
          { type: RestockProblemType.MISSING, count: 1n, note: "" },
        ],
        placements: [
          { placementId: 41n, quantity: 5n },
          { placementId: 43n, quantity: 2n },
        ],
      },
      {
        ...line(5032, 72n, "SKU-TEH-100", "Teh Melati 100g", 20, 300000, { supplierId: 31n, supplierChannelId: 312n }),
        receivedCount: 20n,
        placements: [{ placementId: 42n, quantity: 20n }],
      },
    ],
    logs: [
      log(1, NONE, ONGOING, 61n, "created", 9),
      log(2, ONGOING, ARRIVED, 62n, "signed for the box", 6),
      log(3, ARRIVED, ACCEPTED, 62n, "accepted — 2 broken, 1 missing; courier's charge Rp 5.000", 6),
    ],
  }),

  // GIVEN UP — the parcel never came (lost-is-set-only-before-the-box-arrives).
  restock({
    id: 504n,
    status: LOST,
    createdAtUnix: daysAgo(20),
    receipt: "JNE0000111122",
    shipmentId: 91n,
    invoiceRefId: "INV/2026/09/0200",
    shipmentCost: 18000n,
    lostByUserId: 61n,
    lostAtUnix: daysAgo(5),
    items: [line(5041, 73n, "SKU-GULA-1K", "Gula Pasir 1kg", 40, 640000, { supplierId: 32n })],
    logs: [
      log(1, NONE, ONGOING, 61n, "created", 20),
      log(2, ONGOING, LOST, 61n, "Kurir tidak menemukan alamat, paket dikembalikan ke pengirim", 5),
    ],
  }),

  // CALLED OFF while still on its way (a-restock-is-cancelled-only-while-ongoing).
  restock({
    id: 505n,
    status: CANCELLED,
    createdAtUnix: daysAgo(15),
    invoiceRefId: "INV/2026/09/0301",
    cancelledByUserId: 61n,
    cancelledAtUnix: daysAgo(14),
    items: [line(5051, 71n, "SKU-KOPI-250", "Kopi Arabika 250g", 6, 240000)],
    logs: [
      log(1, NONE, ONGOING, 61n, "created", 15),
      log(2, ONGOING, CANCELLED, 61n, "cancelled — money returned", 14),
    ],
  }),

  // ANOTHER SENDER — Toko Kenanga's, on its way to the same warehouse.
  restock({
    id: 506n,
    status: ONGOING,
    requestingTeamId: 13n,
    createdAtUnix: daysAgo(1),
    receipt: "SCP7777888899",
    shipmentId: 93n,
    financeAccountId: 0n,
    createdByUserId: 64n,
    items: [line(5061, 73n, "SKU-GULA-1K", "Gula Pasir 1kg", 50, 800000, { supplierId: 34n, supplierChannelId: 341n })],
    logs: [log(1, NONE, ONGOING, 64n, "created", 1)],
  }),

  // A DELETED STORE on an accepted line — it still shows, badged (a-deleted-supplier-still-shows-with-a-badge).
  restock({
    id: 507n,
    status: ACCEPTED,
    createdAtUnix: daysAgo(30),
    receipt: "JNE5555666677",
    shipmentId: 91n,
    invoiceRefId: "INV/2026/09/0050",
    shipmentCost: 10000n,
    arrivedByUserId: 62n,
    acceptedByUserId: 62n,
    arrivedAtUnix: daysAgo(27),
    acceptedAtUnix: daysAgo(27),
    transactionId: 8800n,
    items: [
      {
        ...line(5071, 72n, "SKU-TEH-100", "Teh Melati 100g", 15, 225000, { supplierId: 31n, supplierChannelId: 314n }),
        receivedCount: 15n,
        placements: [{ placementId: 42n, quantity: 15n }],
      },
    ],
    logs: [
      log(1, NONE, ONGOING, 61n, "created", 30),
      log(2, ONGOING, ARRIVED, 62n, "signed for the box", 27),
      log(3, ARRIVED, ACCEPTED, 62n, "accepted", 27),
    ],
  }),
];

export function restockFixture(id: bigint): RestockFixture {
  const found = restockFixtures.find((r) => r.id === id);
  if (!found) throw new Error(`no restock fixture ${id}`);

  return found;
}
