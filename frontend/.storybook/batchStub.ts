// inventory_service's BATCH READS as Storybook's stub — BatchList, BatchDetail, BatchPlacementList, StockHistory and
// ProductPlaces, for the Batch list and a batch's page. The one write that reaches these rows is Koreksi Harga
// (batchPriceStub.ts — a batch's price, kept in batchPriceScenario.ts and read back here).
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
// KOREKSI JUMLAH TERIMA (receivedCountScenario.ts) reaches these rows too: a correction's units out are Hilang at the batch
// price — never Terpakai — and leave Siap; units in come back (batch_detail.go countOutExpr); its history row is an ADJUST
// carrying `received_count_correction` (ledger_history.go).
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
import { isEmptied, priceLogsOf, priceNow, resetBatchPriceScenario } from "./batchPriceScenario";
import { correctionsOfBatch } from "./receivedCountScenario";

const DAY = 86_400n;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const daysFromNow = (n: number) => now() + BigInt(n) * DAY;

interface BatchFixture {
  id: bigint;
  warehouseId: bigint;
  deliveryId: bigint;
  receiptNo: string;
  productId: bigint;
  productCode: string;
  name: string;
  supplierId: bigint;
  unitCost: number;
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
  batch({ id: 9101n, deliveryId: 0n, productId: 71n, productCode: "SKU-KOPI-250", name: "Kopi Arabika 250g", unitCost: 40500, arrived: 2n, ready: 2n, expiresIn: 0, age: 3, origin: BatchOrigin.RETURN, shelves: [[43n, 2n]] }),
  batch({ id: 5031n, deliveryId: 503n, receiptNo: "SCP5544332211", productId: 74n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg", supplierId: 31n, unitCost: 66167, arrived: 10n, broken: 2n, lost: 1n, ready: 7n, expiresIn: 20, age: 6, shelves: [[41n, 5n], [43n, 2n]] }),
  batch({ id: 5032n, deliveryId: 503n, receiptNo: "SCP5544332211", productId: 72n, productCode: "SKU-TEH-100", name: "Teh Melati 100g", supplierId: 31n, unitCost: 16167, arrived: 20n, used: 3n, ready: 17n, expiresIn: 150, age: 6, shelves: [[42n, 20n]] }),
  batch({ id: 5071n, deliveryId: 507n, receiptNo: "JNE5555666677", productId: 72n, productCode: "SKU-TEH-100", name: "Teh Melati 100g", supplierId: 31n, unitCost: 15667, arrived: 15n, used: 15n, ready: 0n, expiresIn: 0, age: 27, shelves: [[42n, 15n]] }),
  batch({ id: 3982n, deliveryId: 398n, receiptNo: "JNE1112223334", productId: 71n, productCode: "SKU-KOPI-250", name: "Kopi Arabika 250g", supplierId: 33n, unitCost: 40500, arrived: 24n, used: 6n, ready: 18n, expiresIn: 9, age: 40, shelves: [[41n, 12n], [42n, 12n]] }),
  batch({ id: 3981n, deliveryId: 398n, receiptNo: "JNE1112223334", productId: 73n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg", supplierId: 34n, unitCost: 16400, arrived: 50n, used: 45n, ready: 5n, expiresIn: -3, age: 40, shelves: [[41n, 50n]] }),
];

/** The batches a story may change — reset in preview's `beforeEach`, as the other stubs are. */
let rows: BatchFixture[] = [];
// Products a story took off every shelf (sold, or moved away): ProductPlaces lists none of their racks, as the server's
// does — it reads only racks holding the product now (`stock_count > 0`).
let leftEveryRack = new Set<string>();

/** The product sits on no rack now — its batch page must still name the racks its history and put-away read. */
export function productLeftItsRacksForStory(productId: bigint) {
  leftEveryRack.add(productId.toString());
}

export function resetBatchStub() {
  rows = structuredClone(BATCHES);
  leftEveryRack = new Set();
  // Koreksi Harga's corrections price these rows too — reset with them.
  resetBatchPriceScenario();
}
resetBatchStub();

// ── KOREKSI HARGA (batchPriceStub.ts) ────────────────────────────────────────────────────────────────────────────────────
// A batch's price and units as the rows read them once a story corrected or emptied it; untouched otherwise, so every
// other story reads exactly the fixtures above.

/** A batch a Koreksi Harga story adds — Toko Anggrek's Minyak 7001 at Gudang Pusat, as productStub has it. */
export function addBatchForStory(f: Parameters<typeof batch>[0]) {
  rows = [...rows.filter((b) => b.id !== f.id), batch(f)];
}

/** Units Koreksi Jumlah Terima took out of the batch, net (negative when more went back in). */
function countOut(b: BatchFixture): bigint {
  return correctionsOfBatch(b.id).reduce((s, c) => s + c.unitsOut, 0n);
}

/** The units left as the reads answer them — 0 once a story emptied the batch; less what a correction took out. */
function readyNow(b: BatchFixture): bigint {
  return isEmptied(b.id) ? 0n : b.ready - countOut(b);
}

/** One batch's facts for BatchRevalue's stub (batchPriceStub.ts) — `undefined` for one this stub does not hold. */
export function batchForPrice(batchId: bigint) {
  const b = rows.find((x) => x.id === batchId);
  if (!b) return undefined;
  const price = priceNow(b.id, b.unitCost);
  const units = readyNow(b);
  return { warehouseId: b.warehouseId, productId: b.productId, units, price, value: Number(units) * price, minted: b.unitCost };
}

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
  // A corrected batch reads its new price, and its units left their new value; an emptied one reads 0 left. Tiba keeps
  // the price it was accepted at — what arrived cost that (a-late-cost-is-an-expense-not-a-revaluation).
  const price = priceNow(b.id, b.unitCost);
  const ready = readyNow(b);
  const used = b.used + (b.ready - countOut(b) - ready);

  return {
    id: b.id,
    deliveryId: b.deliveryId,
    receiptNo: b.receiptNo,
    productId: b.productId,
    productCode: b.productCode,
    name: b.name,
    supplierId: b.supplierId,
    unitCost: price,
    costKnown: b.costKnown,
    arrived: b.arrived,
    broken: b.broken,
    lost: b.lost + countOut(b),
    used,
    ready,
    lineCost: Number(b.arrived) * b.unitCost,
    readyValue: Number(ready) * price,
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

// The batch's ledger, newest first: the put-away at the accept (one receive per rack), then what orders took, and each
// price correction — a batch_logs row that moved no unit, read as REVALUATION with its price before and after and the
// value change (ledger_history.go). Every row carries the batch's price and the value it moved, as the server's does.
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
  // A batch a story emptied had its last units taken by an order a minute ago; each correction is a row that moved no unit.
  type Row = {
    id: bigint;
    delta: bigint;
    kind: MovementKind;
    rackId: bigint;
    at: bigint;
    ref: string;
    reason: string;
    actor: bigint;
    correction?: (typeof corrections)[number];
    count?: ReturnType<typeof correctionsOfBatch>[number];
  };
  const corrections = priceLogsOf(b.id);
  const extra: Row[] = [];
  if (isEmptied(b.id) && b.ready > 0n) {
    extra.push({ id: b.id * 100n + 99n, delta: -b.ready, kind: MovementKind.PICK, rackId: b.shelves[0]?.[0] ?? 0n, at: now() - 60n, ref: `ORD-${b.id}-2`, reason: "", actor: b.acceptedBy });
  }
  for (const l of corrections) {
    extra.push({ id: l.id, delta: 0n, kind: MovementKind.REVALUATION, rackId: 0n, at: l.atUnix, ref: "", reason: l.reason, actor: l.actorUserId, correction: l });
  }
  // Each received-count correction: the `adjustment` it posted, on the rack named (Koreksi Jumlah Terima).
  for (const c of correctionsOfBatch(b.id)) {
    extra.push({ id: c.id, delta: -c.unitsOut, kind: MovementKind.ADJUST, rackId: c.placementId, at: c.atUnix, ref: "", reason: c.reason, actor: c.actorUserId, count: c });
  }
  const all: Row[] = [
    ...out.map((m, i) => ({ ...m, id: b.id * 100n + BigInt(i + 1), reason: "", actor: b.acceptedBy })),
    ...extra,
  ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

  let balance = 0n;
  let price = b.unitCost;
  const rowsOut = all.map((m) => {
    balance += m.delta;
    const before = price;
    if (m.correction) price = m.correction.to;
    return {
      id: m.id,
      productId: b.productId,
      warehouseId: b.warehouseId,
      delta: m.delta,
      balance,
      kind: m.kind,
      reason: m.reason,
      ref: m.ref,
      actorUserId: m.actor,
      createdAt: iso(m.at),
      rackId: m.rackId,
      batchId: b.id,
      isOverride: m.correction?.isOverride ?? m.count?.isOverride ?? false,
      receivedCountCorrection: m.count
        ? {
            fromCount: m.count.fromCount,
            toCount: m.count.toCount,
            reason: m.count.reason,
            restockId: m.count.subject === "restock" ? m.count.targetId : 0n,
            transferId: m.count.subject === "transfer" ? m.count.targetId : 0n,
          }
        : undefined,
      priceUnitBefore: before,
      priceUnitAfter: price,
      valueChange: m.correction ? m.correction.valueDelta : Number(m.delta) * price,
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
          b.productCode.toLowerCase().includes(q) ||
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
      readyValueTotal: matched.reduce((s, b) => s + (b.costKnown ? Number(readyNow(b)) * priceNow(b.id, b.unitCost) : 0), 0),
      expiringSoonCount: BigInt(matched.filter(expiringSoon).length),
    };
  },

  batchDetail(req) {
    const b = visible(req.teamId, req.batchId);
    // Each figure at the price it left at, as the server reads its own rows: the door's problems and the units used at
    // the accepted price, the last units an order took meanwhile at the price then; the newest correction's price before.
    const corrections = priceLogsOf(b.id);
    const taken = b.ready - countOut(b) - readyNow(b);
    return {
      batch: toWire(b),
      returnedQty: 0n,
      lastReturnUnix: 0n,
      brokenValue: Number(b.broken) * b.unitCost,
      // Hilang carries a correction's units at the batch price (a-stock-in-correction-keeps-the-batch-price).
      lostValue: Number(b.lost + countOut(b)) * b.unitCost,
      usedValue: Number(b.used) * b.unitCost + Number(taken) * priceNow(b.id, b.unitCost),
      priceCorrected: corrections.length > 0,
      priceCorrectedFrom: corrections[corrections.length - 1]?.from ?? 0,
    };
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
      const held = !leftEveryRack.has(productId.toString());
      for (const r of racks.filter((x) => held && x.warehouseId === req.warehouseId)) {
        mapData[r.id.toString()] = { productId, rackId: r.id, rackCode: r.code, onHand: 0n };
      }
      items[productId.toString()] = { items: [{ d: { case: "place" as const, value: { mapData } } }] };
    }
    return { items };
  },
};
