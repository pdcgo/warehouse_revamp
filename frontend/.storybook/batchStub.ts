// inventory_service's BATCH READS as Storybook's stub — BatchList, BatchDetail, BatchPlacementList, StockHistory and
// ProductPlaces, for the Batch list and a batch's page. Read-only: nothing on those screens writes a batch.
//
// A batch is one product's good units from one delivery line, at one landed price (one-batch-per-line). Gudang Pusat's
// (11), consistent with the restock fixtures where they meet:
//
//   5031  Beras 74 (Melati)   restock 503   arrived 10 = 2 broken + 1 missing + 7 ready     expires in 20 days
//   5032  Teh 72 (Pusat)      restock 503   arrived 20 = 3 used + 17 ready                   expires in 150 days
//   5071  Teh 72 (Pusat)      restock 507   arrived 15 = 15 used — DEPLETED                  no expiry
//   3981  Gula 73 (Kenanga)   restock 398   arrived 50 = 45 used + 5 ready                   EXPIRED 3 days ago
//   3982  Kopi 71 (Pusat)     restock 398   arrived 24 = 6 used + 18 ready                   expires in 9 days
//   9101  Kopi 71 (Pusat)     a RETURN      arrived 2  = 2 ready                             no expiry
//
// The rules the server plays (batch_list.go, batch_detail.go): scoped to the warehouse (another's batch is NotFound);
// the list newest first; *expiring soon* is within 30 days; the header totals are over the WHOLE filtered set, not
// the page. A batch's places are where the accept put it (a-batch-shows-the-racks-it-was-put-on) — history, not where
// its units sit now.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  BatchDateField,
  BatchExpiryFilter,
  BatchOrigin,
  type InventoryService,
  MovementKind,
} from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { racks } from "./fixtures";

const DAY = 86_400n;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const daysFromNow = (n: number) => now() + BigInt(n) * DAY;

interface BatchFixture {
  id: bigint;
  warehouseId: bigint;
  deliveryId: bigint;
  receiptNo: string;
  productId: bigint;
  sku: string;
  name: string;
  supplierId: bigint;
  unitCost: bigint;
  costKnown: boolean;
  arrived: bigint;
  broken: bigint;
  lost: bigint;
  used: bigint;
  ready: bigint;
  /** Days from today; 0 = no expiry. */
  expiresIn: number;
  /** Days ago it was minted — the accept. */
  age: number;
  createdBy: bigint;
  acceptedBy: bigint;
  origin: BatchOrigin;
  /** Where the accept put it: rack id → units. */
  shelves: [bigint, bigint][];
}

function batch(f: Omit<BatchFixture, "warehouseId" | "costKnown" | "broken" | "lost" | "used" | "createdBy" | "acceptedBy" | "origin" | "supplierId" | "receiptNo"> & Partial<BatchFixture>): BatchFixture {
  return {
    warehouseId: 11n,
    costKnown: true,
    broken: 0n,
    lost: 0n,
    used: 0n,
    createdBy: 61n,
    acceptedBy: 62n,
    origin: BatchOrigin.RESTOCK,
    supplierId: 0n,
    receiptNo: "",
    ...f,
  };
}

const BATCHES: BatchFixture[] = [
  // A return carries no restock number — the server reads 0 there (batch_detail.go: COALESCE(r.id, 0)).
  batch({ id: 9101n, deliveryId: 0n, productId: 71n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g", unitCost: 40500n, arrived: 2n, ready: 2n, expiresIn: 0, age: 3, origin: BatchOrigin.RETURN, shelves: [[43n, 2n]] }),
  batch({ id: 5031n, deliveryId: 503n, receiptNo: "SCP5544332211", productId: 74n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg", supplierId: 31n, unitCost: 66167n, arrived: 10n, broken: 2n, lost: 1n, ready: 7n, expiresIn: 20, age: 6, shelves: [[41n, 5n], [43n, 2n]] }),
  batch({ id: 5032n, deliveryId: 503n, receiptNo: "SCP5544332211", productId: 72n, sku: "SKU-TEH-100", name: "Teh Melati 100g", supplierId: 31n, unitCost: 16167n, arrived: 20n, used: 3n, ready: 17n, expiresIn: 150, age: 6, shelves: [[42n, 20n]] }),
  batch({ id: 5071n, deliveryId: 507n, receiptNo: "JNE5555666677", productId: 72n, sku: "SKU-TEH-100", name: "Teh Melati 100g", supplierId: 31n, unitCost: 15667n, arrived: 15n, used: 15n, ready: 0n, expiresIn: 0, age: 27, shelves: [[42n, 15n]] }),
  batch({ id: 3982n, deliveryId: 398n, receiptNo: "JNE1112223334", productId: 71n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g", supplierId: 33n, unitCost: 40500n, arrived: 24n, used: 6n, ready: 18n, expiresIn: 9, age: 40, shelves: [[41n, 12n], [42n, 12n]] }),
  batch({ id: 3981n, deliveryId: 398n, receiptNo: "JNE1112223334", productId: 73n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg", supplierId: 34n, unitCost: 16400n, arrived: 50n, used: 45n, ready: 5n, expiresIn: -3, age: 40, shelves: [[41n, 50n]] }),
];

/** The batches a story may change — reset in preview's `beforeEach`, as the other stubs are. */
let rows: BatchFixture[] = [];
export function resetBatchStub() {
  rows = structuredClone(BATCHES);
}
resetBatchStub();

/** A warehouse with no batches — for an empty list's story. Lasts the story. */
export function noBatchesAt(warehouseId: bigint) {
  rows = rows.filter((b) => b.warehouseId !== warehouseId);
}

const notFound = () => new ConnectError("batch not found", Code.NotFound);
const expiresOn = (b: BatchFixture) => (b.expiresIn === 0 ? 0n : daysFromNow(b.expiresIn));
const createdAt = (b: BatchFixture) => now() - BigInt(b.age) * DAY;
// Within 30 days, the past included — as the server's `expired_at <= cutoff`.
const expiringSoon = (b: BatchFixture) => b.expiresIn !== 0 && b.expiresIn <= 30;

function toWire(b: BatchFixture) {
  const at = createdAt(b);

  return {
    id: b.id,
    deliveryId: b.deliveryId,
    receiptNo: b.receiptNo,
    productId: b.productId,
    sku: b.sku,
    name: b.name,
    supplierId: b.supplierId,
    unitCost: b.unitCost,
    costKnown: b.costKnown,
    arrived: b.arrived,
    broken: b.broken,
    lost: b.lost,
    used: b.used,
    ready: b.ready,
    lineCost: b.arrived * b.unitCost,
    readyValue: b.ready * b.unitCost,
    expiresOnUnix: expiresOn(b),
    createdAtUnix: at,
    acceptedAtUnix: at,
    createdBy: b.createdBy,
    acceptedBy: b.acceptedBy,
    origin: b.origin,
  };
}

function visible(teamId: bigint, batchId: bigint): BatchFixture {
  const found = rows.find((b) => b.id === batchId && b.warehouseId === teamId);
  if (!found) throw notFound();
  return found;
}

type PageReq = { page?: number; limit?: number } | undefined;
function pageOf<R>(all: R[], page: PageReq) {
  const limit = page?.limit || 20;
  const current = page?.page || 1;
  return {
    rows: all.slice((current - 1) * limit, current * limit),
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(all.length / limit)), totalItems: BigInt(all.length) },
  };
}

// The batch's ledger, newest first: the put-away at the accept (one receive per rack), then what orders took.
function movementsOf(b: BatchFixture) {
  const at = createdAt(b);
  const iso = (unix: bigint) => new Date(Number(unix) * 1000).toISOString();
  const out: { delta: bigint; kind: MovementKind; rackId: bigint; at: bigint; ref: string }[] = [];
  for (const [rackId, qty] of b.shelves) {
    out.push({ delta: qty, kind: b.origin === BatchOrigin.RETURN ? MovementKind.RECEIVE : MovementKind.RECEIVE, rackId, at, ref: `RST-${b.deliveryId}` });
  }
  if (b.used > 0n) {
    out.push({ delta: -b.used, kind: MovementKind.PICK, rackId: b.shelves[0]?.[0] ?? 0n, at: at + 2n * DAY, ref: `ORD-${b.id}` });
  }

  let balance = 0n;
  const rowsOut = out.map((m, i) => {
    balance += m.delta;
    return {
      id: b.id * 100n + BigInt(i + 1),
      productId: b.productId,
      warehouseId: b.warehouseId,
      delta: m.delta,
      balance,
      kind: m.kind,
      reason: "",
      ref: m.ref,
      actorUserId: b.acceptedBy,
      createdAt: iso(m.at),
      rackId: m.rackId,
      batchId: b.id,
    };
  });

  return rowsOut.reverse();
}

export const batchStubService: Partial<ServiceImpl<typeof InventoryService>> = {
  batchList(req) {
    const f = req.filter;
    const q = (f?.search ?? "").trim().toLowerCase().replace(/^#/, "");
    const field = f?.dateField ?? BatchDateField.UNSPECIFIED;

    const matched = rows
      .filter((b) => b.warehouseId === req.teamId)
      .filter((b) => !f?.productId || b.productId === f.productId)
      .filter((b) => !f?.supplierId || b.supplierId === f.supplierId)
      .filter(
        (b) =>
          !q ||
          b.id.toString() === q ||
          b.deliveryId.toString() === q ||
          b.receiptNo.toLowerCase().includes(q) ||
          b.sku.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q),
      )
      .filter((b) => {
        if (f?.expiry === BatchExpiryFilter.EXPIRING_SOON) return expiringSoon(b);
        if (f?.expiry === BatchExpiryFilter.NO_EXPIRY) return b.expiresIn === 0;
        return true;
      })
      .filter((b) => {
        if (field === BatchDateField.UNSPECIFIED || (!f?.fromUnix && !f?.toUnix)) return true;
        const at = field === BatchDateField.EXPIRING ? expiresOn(b) : createdAt(b);
        if (at === 0n) return false;
        return (!f.fromUnix || at >= f.fromUnix) && (!f.toUnix || at <= f.toUnix);
      })
      .sort((a, b) => a.age - b.age || (a.id > b.id ? -1 : 1));

    const { rows: page, pageInfo } = pageOf(matched, req.page);
    const mapData: Record<string, ReturnType<typeof toWire>> = {};
    for (const b of page) mapData[b.id.toString()] = toWire(b);

    return {
      items: [{ d: { case: "batch" as const, value: { mapData } } }],
      ids: page.map((b) => b.id),
      pageInfo,
      readyValueTotal: matched.reduce((s, b) => s + (b.costKnown ? b.ready * b.unitCost : 0n), 0n),
      expiringSoonCount: BigInt(matched.filter(expiringSoon).length),
    };
  },

  batchDetail(req) {
    const b = visible(req.teamId, req.batchId);
    return { batch: toWire(b), returnedQty: 0n, lastReturnUnix: 0n };
  },

  batchPlacementList(req) {
    const b = visible(req.teamId, req.filter?.batchId ?? 0n);
    const { rows: page, pageInfo } = pageOf(b.shelves, req.page);
    const mapData: Record<string, { rackId: bigint; qty: bigint; lastOpnameUnix: bigint }> = {};
    for (const [rackId, qty] of page) mapData[rackId.toString()] = { rackId, qty, lastOpnameUnix: 0n };

    return { items: [{ d: { case: "shelf" as const, value: { mapData } } }], ids: page.map(([rackId]) => rackId), pageInfo };
  },

  stockHistory(req) {
    const b = rows.find((x) => x.id === req.filter?.batchId && x.warehouseId === req.warehouseId);
    const all = b ? movementsOf(b) : [];
    const from = req.filter?.fromUnix ?? 0n;
    const to = req.filter?.toUnix ?? 0n;
    const inRange = all.filter((m) => {
      const at = BigInt(Math.floor(Date.parse(m.createdAt) / 1000));
      return (!from || at >= from) && (!to || at <= to);
    });
    const { rows: page, pageInfo } = pageOf(inRange, req.page);
    const mapData: Record<string, (typeof all)[number]> = {};
    for (const m of page) mapData[m.id.toString()] = m;

    return { items: [{ d: { case: "movement" as const, value: { mapData } } }], ids: page.map((m) => m.id), pageInfo };
  },

  // The rack codes for a product's places — every rack of the warehouse, for the batch page's labels.
  productPlaces(req) {
    type Place = { productId: bigint; rackId: bigint; rackCode: string; onHand: bigint };
    const items: Record<string, { items: { d: { case: "place"; value: { mapData: Record<string, Place> } } }[] }> = {};
    for (const productId of req.filter?.ids ?? []) {
      const mapData: Record<string, Place> = {};
      for (const r of racks.filter((x) => x.warehouseId === req.warehouseId)) {
        mapData[r.id.toString()] = { productId, rackId: r.id, rackCode: r.code, onHand: 0n };
      }
      items[productId.toString()] = { items: [{ d: { case: "place" as const, value: { mapData } } }] };
    }
    return { items };
  },
};
