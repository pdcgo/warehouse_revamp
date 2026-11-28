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
//   9101  Kopi 71 (Pusat)     a RETURN      arrived 2  = 2 ready                             no expiry   order 106's return
//
// KOREKSI JUMLAH TERIMA (receivedCountScenario.ts) reaches these rows too: a correction's units out are Hilang at the batch
// price — never Terpakai — and leave Siap; units in come back (batch_detail.go countOutExpr); its history row is an ADJUST
// carrying `received_count_correction` (ledger_history.go).
//
// The rules the server plays (batch_list.go, batch_detail.go): scoped to the warehouse (another's batch is NotFound);
// the list newest first; *expiring soon* is within 30 days; the header totals are over the WHOLE filtered set, not
// the page; the team filter keeps the batches its OWNER holds (the-batch-list-filters-by-team) — here the product's
// team in productStub's catalogue, the same owner the row names. A batch's places are where the accept put it (a-batch-shows-the-racks-it-was-put-on) — history, not where
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
import { allProducts } from "./productStub";
import { correctionsOfBatch } from "./receivedCountScenario";

const DAY = 86_400n;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const daysFromNow = (n: number) => now() + BigInt(n) * DAY;

// When each rack was last counted, in days — Penempatan's opname badge has all three (last-count-is-a-badge): A-01-1 a
// fresh count, B-02-1 one past the 14 days that make it overdue, A-01-2 never.
const LAST_COUNTED_DAYS_AGO: Record<string, number> = { "41": 3, "43": 30 };

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
  /** The order whose return minted it — 0 for any other batch (a-returns-batch-opens-its-order). */
  returnOrderId: bigint;
  /** Where the accept put it: rack id → units. */
  shelves: [bigint, bigint][];
}

function batch(f: Omit<BatchFixture, "warehouseId" | "costKnown" | "broken" | "lost" | "used" | "createdBy" | "acceptedBy" | "origin" | "supplierId" | "receiptNo" | "returnOrderId"> & Partial<BatchFixture>): BatchFixture {
  return {
    warehouseId: 11n,
    costKnown: true,
    broken: 0n,
    lost: 0n,
    used: 0n,
    createdBy: 61n,
    acceptedBy: 62n,
    origin: BatchOrigin.RESTOCK,
    returnOrderId: 0n,
    supplierId: 0n,
    receiptNo: "",
    ...f,
  };
}

const BATCHES: BatchFixture[] = [
  // A return carries no restock number — the server reads 0 there (batch_detail.go: COALESCE(r.id, 0)) — and names the
  // order whose return it is (return_orders.go: the order naming its `return` transaction) — Pak Firman's 106.
  batch({ id: 9101n, deliveryId: 0n, productId: 71n, productCode: "SKU-KOPI-250", name: "Kopi Arabika 250g", unitCost: 40500, arrived: 2n, ready: 2n, expiresIn: 0, age: 3, origin: BatchOrigin.RETURN, returnOrderId: 106n, shelves: [[43n, 2n]] }),
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

// Where products sit NOW for ONE story (`productPlacesForStory`) — by product id, `[rackId, onHand]` per rack holding it,
// as the server's ProductPlaces answers (only racks with the product on them), and the racks BatchList's rows name
// (`rackCodesOf`). null = ProductPlaces lists every rack, BatchList the racks the product's batches were put on.
let placesNow: Map<string, [bigint, bigint][]> | null = null;

/** For ONE story (its `beforeEach`): ProductPlaces and BatchList's racks answer these for these products; others as before. */
export function productPlacesForStory(places: Record<string, [bigint, bigint][]>) {
  placesNow = new Map(Object.entries(places));
}

/** A row of a product's history read WITHOUT a batch, as the server sends it (#142/#143) — the fields a story sets. */
export interface ProductHistoryRowForStory {
  id: bigint;
  kind: MovementKind;
  delta: bigint;
  balance: bigint;
  rackId: bigint;
  batchId: bigint;
  actorUserId: bigint;
  /** Minutes ago — the rows' times, newest first as given. */
  minutesAgo: number;
  reason?: string;
  priceUnitBefore?: number;
  priceUnitAfter?: number;
  valueChange?: number;
}

// A product's history WITHOUT a batch for ONE story (`productHistoryForStory`) — the warehouse product page's Stock History
// and Placement History: the rows as given, newest first, each naming its batch and kind as the server's do since #142/#143
// (a price correction among them, on no rack). null = none: the stub otherwise serves a history only narrowed to a batch.
let productHistoryNow: Map<string, ProductHistoryRowForStory[]> | null = null;

/** For ONE story (its `beforeEach`): StockHistory without a batch answers these rows for this product in its warehouse. */
export function productHistoryForStory(productId: bigint, rows: ProductHistoryRowForStory[]) {
  (productHistoryNow ??= new Map()).set(productId.toString(), rows);
}

// A kind asked as a filter reaches what the server's does (ledger_history.go kindsWhere): ADJUST keeps the broken and the
// found it reached before they had words of their own, RETURN the cancel.
function kindReaches(asked: MovementKind, kind: MovementKind): boolean {
  if (asked === kind) return true;
  if (asked === MovementKind.ADJUST) return kind === MovementKind.BROKEN || kind === MovementKind.FOUND;
  if (asked === MovementKind.RETURN) return kind === MovementKind.CANCEL;
  return false;
}

/**
 * THE RACKS A BATCH'S PRODUCT SITS ON NOW in its warehouse, by code (the-expiry-report-is-the-batch-list) — as BatchList
 * serves them: none for a batch with nothing left; a story's `productPlacesForStory` racks holding units; none for a
 * product a story took off every rack; else the racks this warehouse's batches of the product with units left were put
 * on (a rack counts the product, never a batch).
 */
function rackCodesOf(b: BatchFixture): string[] {
  if (readyNow(b) <= 0n) return [];
  const codeOf = (rackId: bigint) => racks.find((r) => r.id === rackId && r.warehouseId === b.warehouseId)?.code;
  const now = placesNow?.get(b.productId.toString());
  const ids = now
    ? now.filter(([, onHand]) => onHand > 0n).map(([rackId]) => rackId)
    : leftEveryRack.has(b.productId.toString())
      ? []
      : rows
          .filter((x) => x.warehouseId === b.warehouseId && x.productId === b.productId && readyNow(x) > 0n)
          .flatMap((x) => x.shelves.map(([rackId]) => rackId));
  return [...new Set(ids.map(codeOf).filter((c): c is string => c !== undefined))].sort();
}

/** Every team filter BatchList was asked with (0n = none), as sent — reset with the stub, so a story reads its own. */
export const batchListScenario = { ownerTeamIds: [] as bigint[] };

/** Whose a batch is — its product's owner in the catalogue (the server reads `batches.team_id`, the same team). */
function ownerOf(b: BatchFixture): bigint {
  return allProducts().find((p) => p.id === b.productId)?.teamId ?? 0n;
}

export function resetBatchStub() {
  batchListScenario.ownerTeamIds = [];
  rows = structuredClone(BATCHES);
  leftEveryRack = new Set();
  placesNow = null;
  productHistoryNow = null;
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
// Units left only, as BatchList (expiry-is-a-report): an emptied batch has nothing left to expire.
const expiringSoon = (b: BatchFixture) => b.expiresIn !== 0 && b.expiresIn <= 30 && readyNow(b) > 0n;

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
    returnOrderId: b.returnOrderId,
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
    batchListScenario.ownerTeamIds.push(f?.ownerTeamId ?? 0n);

    const matched = rows
      .filter((b) => b.warehouseId === req.teamId)
      .filter((b) => !f?.productId || b.productId === f.productId)
      .filter((b) => !f?.supplierId || b.supplierId === f.supplierId)
      .filter((b) => !f?.ownerTeamId || ownerOf(b) === f.ownerTeamId)
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
    const mapData: Record<string, ReturnType<typeof toWire> & { rackCodes: string[] }> = {};
    // BatchList ALONE names the product's racks (StockBatch.rack_codes) — the other reads leave them empty, as the server.
    for (const b of page) mapData[b.id.toString()] = { ...toWire(b), rackCodes: rackCodesOf(b) };

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
    for (const [rackId, qty] of page) {
      const counted = LAST_COUNTED_DAYS_AGO[rackId.toString()];
      mapData[rackId.toString()] = { rackId, qty, lastOpnameUnix: counted === undefined ? 0n : daysFromNow(-counted) };
    }

    return { items: [{ d: { case: "shelf" as const, value: { mapData } } }], ids: page.map(([rackId]) => rackId), pageInfo };
  },

  stockHistory(req) {
    // Without a batch: the story's product history (productHistoryForStory), narrowed to a kind as the server narrows it.
    if (!req.filter?.batchId) {
      const asked = req.filter?.kind ?? MovementKind.UNSPECIFIED;
      const mine = (productHistoryNow?.get((req.filter?.productId ?? 0n).toString()) ?? []).filter(
        (m) => asked === MovementKind.UNSPECIFIED || kindReaches(asked, m.kind),
      );
      const { rows: page, pageInfo } = pageOf(mine, req.page);
      const mapData: Record<string, object> = {};
      for (const m of page) {
        mapData[m.id.toString()] = {
          id: m.id,
          productId: req.filter?.productId ?? 0n,
          warehouseId: req.warehouseId,
          delta: m.delta,
          balance: m.balance,
          kind: m.kind,
          reason: m.reason ?? "",
          ref: "",
          actorUserId: m.actorUserId,
          createdAt: new Date(Date.now() - m.minutesAgo * 60_000).toISOString(),
          rackId: m.rackId,
          batchId: m.batchId,
          isOverride: false,
          priceUnitBefore: m.priceUnitBefore ?? 0,
          priceUnitAfter: m.priceUnitAfter ?? 0,
          valueChange: m.valueChange ?? 0,
        };
      }

      return { items: [{ d: { case: "movement" as const, value: { mapData } } }], ids: page.map((m) => m.id), pageInfo };
    }

    const b = rows.find((x) => x.id === req.filter?.batchId && x.warehouseId === req.warehouseId);
    const all = b ? movementsOf(b) : [];
    const from = req.filter?.fromUnix ?? 0n;
    const to = req.filter?.toUnix ?? 0n;
    // One kind, as the server's filter takes it — 0 (unspecified) is every kind (a batch's Riwayat's Kegiatan).
    const kind = req.filter?.kind ?? 0;
    const inRange = all.filter((m) => {
      const at = BigInt(Math.floor(Date.parse(m.createdAt) / 1000));
      return (!from || at >= from) && (!to || at <= to) && (!kind || m.kind === kind);
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
      const now = placesNow?.get(productId.toString());
      if (now) {
        for (const [rackId, onHand] of now) {
          const r = racks.find((x) => x.id === rackId && x.warehouseId === req.warehouseId);
          if (r) mapData[r.id.toString()] = { productId, rackId: r.id, rackCode: r.code, onHand };
        }
        items[productId.toString()] = { items: [{ d: { case: "place" as const, value: { mapData } } }] };
        continue;
      }
      const held = !leftEveryRack.has(productId.toString());
      // Every rack of the warehouse is listed (the batch page's labels), each holding what this warehouse's batches of
      // the product have LEFT on it — a batch's units left fill its shelves in put-away order. So a figure read from it,
      // the Adjust dialog's *n on hand across every place*, agrees with the page's Siap; it was 0 on every rack.
      const left = new Map<string, bigint>();
      for (const b of rows.filter((x) => held && x.warehouseId === req.warehouseId && x.productId === productId)) {
        let rest = readyNow(b);
        for (const [rackId, qty] of b.shelves) {
          if (rest <= 0n) break;
          const take = qty < rest ? qty : rest;
          left.set(rackId.toString(), (left.get(rackId.toString()) ?? 0n) + take);
          rest -= take;
        }
      }
      for (const r of racks.filter((x) => held && x.warehouseId === req.warehouseId)) {
        mapData[r.id.toString()] = { productId, rackId: r.id, rackCode: r.code, onHand: left.get(r.id.toString()) ?? 0n };
      }
      items[productId.toString()] = { items: [{ d: { case: "place" as const, value: { mapData } } }] };
    }
    return { items };
  },
};
