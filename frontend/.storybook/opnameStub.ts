// inventory_service's OpnameService as Storybook's stub — the ONLY implementation the stock count has until the backend
// step (the real server answers Unimplemented).
//
// It plays the DECIDED rules (docs/business/inventory/opname_decision.md), because the screens must already honour them:
//   one-active-count-per-warehouse                 a second active session is refused.
//   the-plan-target-is-only-a-filter               the plan's target filters the snapshot and is not kept.
//   a-snapshot-includes-rows-at-zero               shelf rows at 0 are snapshotted like any other.
//   an-all-count-visits-every-rack                 an `all` session lists every rack, empty ones too.
//   a-count-is-blind-then-revealed                 a counter's read carries no book figure until the row is counted.
//   a-row-keeps-only-its-latest-count              the one recount replaces the blind count; a third is refused.
//   a-short-rack-gets-a-lost-draft-from-the-system the lost draft is the shortage less the broken, at least 0.
//   a-surplus-draft-is-counted-by-the-system       the surplus draft is the count less the book.
//   a-difference-needs-its-reason-on-the-draft     marking counted is refused while a draft has no reason.
//   a-counted-row-is-read-only-until-sent-back     a counted row takes no count; the admin sends it back.
//   a-unit-never-stocked-here-comes-in-by-restock  a found product its team never had here is refused.
//   broken-posts-as-written-the-rest-nets          finalize: broken as written, the rest netted per product.
//   broken-takes-its-batch-before-lost             broken, then lost, each oldest batch first.
//   a-surplus-claims-the-oldest-loss-first         then mint at the team's newest price here.
//   nobody-finalizes-their-own-count               a counter of the session cannot finalize it.
//
// WRITEABLE: a count made in one step is revealed in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  OpnameDraftType as DT,
  OpnameFinalizeBlock as FB,
  OpnamePlan,
  OpnamePostType as PT,
  OpnameRackListDataType,
  OpnameRowListDataType,
  OpnameRowStatus as RS,
  OpnameService,
  OpnameSessionListDataType,
  OpnameSessionStatus as SS,
} from "../src/gen/warehouse/inventory/v1/opname_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { products, racks } from "./fixtures";
import {
  type OpnameBatchFixture,
  type OpnameProblemFixture,
  type OpnameRowFixture,
  type OpnameSessionFixture,
  opnameBatchFixtures,
  opnameProblemFixtures,
  opnameRowFixtures,
  opnameSessionFixtures,
} from "./opnameFixtures";
import { sessionScenario } from "./sessionScenario";
import { SELF_ID } from "./userStub";

let sessions: OpnameSessionFixture[] = [];
let rows: OpnameRowFixture[] = [];
let batches: OpnameBatchFixture[] = [];
let problems: OpnameProblemFixture[] = [];
let nextSessionId = 100n;
let nextRowId = 10_000n;
let nextTransactionId = 5_000n;

export function resetOpnameStub() {
  sessions = structuredClone(opnameSessionFixtures);
  rows = structuredClone(opnameRowFixtures);
  batches = structuredClone(opnameBatchFixtures);
  problems = structuredClone(opnameProblemFixtures);
  nextSessionId = 100n;
  nextRowId = 10_000n;
  nextTransactionId = 5_000n;
}

resetOpnameStub();

/** A `beforeEach`: the signed-in person counted one of Gudang Cabang's rows — so they may not finalize session 21. */
export function opnameSelfCounted() {
  const row = rows.find((r) => r.id === 2105n);
  if (row) row.countedById = SELF_ID;
}

/** A `beforeEach`: Gudang Pusat has no active session — the list offers New Session. */
export function opnameNoActiveSession() {
  for (const s of sessions) if (s.warehouseId === 11n && s.status === SS.ACTIVE) s.status = SS.CANCEL;
}

const now = () => BigInt(Math.floor(Date.now() / 1000));

const notFound = () => new ConnectError("opname session not found", Code.NotFound);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

// The admin's side — the book figure in full. Staff are refused it: it would undo the blind count.
const isAdmin = () => sessionScenario.role !== Role.WAREHOUSE_STAFF;
function adminOnly() {
  if (!isAdmin()) throw new ConnectError("the warehouse admin's", Code.PermissionDenied);
}

type PageReq = { page?: number; limit?: number } | undefined;

function pageOf<R>(all: R[], page: PageReq) {
  const limit = page?.limit || 20;
  const current = page?.page || 1;

  return {
    rows: all.slice((current - 1) * limit, current * limit),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(all.length / limit)),
      totalItems: BigInt(all.length),
    },
  };
}

function sessionOf(warehouseId: bigint, id: bigint): OpnameSessionFixture {
  const found = sessions.find((s) => s.id === id && s.warehouseId === warehouseId);
  if (!found) throw notFound();

  return found;
}

function activeSessionOf(warehouseId: bigint, id: bigint): OpnameSessionFixture {
  const s = sessionOf(warehouseId, id);
  if (s.status !== SS.ACTIVE) throw precondition("the session is not active");

  return s;
}

function rowOf(warehouseId: bigint, id: bigint): OpnameRowFixture {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new ConnectError("opname row not found", Code.NotFound);
  sessionOf(warehouseId, row.sessionId);

  return row;
}

const rowsOf = (sessionId: bigint) => rows.filter((r) => r.sessionId === sessionId);

// ── The drafts, worked out from the counts the way the server will ─────────────────────────────────────────────────

function draftsOf(row: OpnameRowFixture) {
  if (!row.revealed) return [];

  const drafts: { type: DT; stockCount: bigint; note: string }[] = [];
  if (row.broken > 0n) drafts.push({ type: DT.BROKEN, stockCount: row.broken, note: row.brokenNote });

  const short = row.system - row.count;
  if (short > 0n) {
    const lost = short - row.broken;
    if (lost > 0n) drafts.push({ type: DT.LOST, stockCount: lost, note: row.lostNote });
  }
  if (row.count > row.system) drafts.push({ type: DT.SURPLUS, stockCount: row.count - row.system, note: row.surplusNote });

  return drafts;
}

/** `blind` — a counter's read: no book figure before the row is counted. */
function rowWire(row: OpnameRowFixture, blind: boolean) {
  const hidden = blind && !row.revealed;

  return {
    id: row.id,
    sessionId: row.sessionId,
    teamId: row.teamId,
    productId: row.productId,
    productSku: row.sku,
    productName: row.name,
    placementId: row.placementId,
    placementCode: row.placementCode,
    status: row.status,
    revealed: row.revealed,
    systemStockCount: hidden ? 0n : row.system,
    recountedStockCount: row.revealed ? row.count : 0n,
    recounted: row.recounted,
    countedById: row.countedById,
    foundHere: row.foundHere,
    drafts: draftsOf(row),
  };
}

const differs = (r: OpnameRowFixture) => r.revealed && r.count !== r.system;

function sessionWire(s: OpnameSessionFixture) {
  const its = rowsOf(s.id);
  // An unfinished session's difference count leaks the book — the admin's figure only.
  const showDifferences = isAdmin() || s.status !== SS.ACTIVE;

  return {
    id: s.id,
    warehouseId: s.warehouseId,
    status: s.status,
    plan: s.plan,
    createdById: s.createdById,
    createdAtUnix: s.createdAtUnix,
    finalizedById: s.finalizedById,
    finalizedAtUnix: s.finalizedAtUnix,
    rowCount: BigInt(its.length),
    countedRowCount: BigInt(its.filter((r) => r.status === RS.COUNTED).length),
    differenceRowCount: showDifferences ? BigInt(its.filter((r) => r.status === RS.COUNTED && differs(r)).length) : 0n,
    rackCount: BigInt(racksOfSession(s).length),
    productCount: BigInt(new Set(its.map((r) => r.productId.toString())).size),
  };
}

const warehouseRacks = (warehouseId: bigint) =>
  racks.filter((r) => r.warehouseId === warehouseId && !r.deleted).sort((a, b) => (a.code < b.code ? -1 : 1));

// The racks to visit: every rack of the warehouse for an `all` session, the racks of its rows otherwise.
function racksOfSession(s: OpnameSessionFixture) {
  const its = rowsOf(s.id);
  if (s.plan === OpnamePlan.ALL) return warehouseRacks(s.warehouseId);

  const ids = new Set(its.map((r) => r.placementId.toString()));
  return warehouseRacks(s.warehouseId).filter((r) => ids.has(r.id.toString()));
}

function rackWire(sessionId: bigint, rack: { id: bigint; code: string }) {
  const its = rowsOf(sessionId).filter((r) => r.placementId === rack.id);

  return {
    placementId: rack.id,
    code: rack.code,
    rowCount: BigInt(its.length),
    countedRowCount: BigInt(its.filter((r) => r.status === RS.COUNTED).length),
  };
}

// ── The snapshot ───────────────────────────────────────────────────────────────────────────────────────────────────

// The shelf book the snapshot copies: what the batches say is in the warehouse, spread over racks. The stub keeps it as
// a fixed table per product — enough to make a plan select rows, rows at 0 included.
const SHELF: { warehouseId: bigint; productId: bigint; placementId: bigint; stock: bigint }[] = [
  { warehouseId: 11n, productId: 74n, placementId: 41n, stock: 5n },
  { warehouseId: 11n, productId: 74n, placementId: 42n, stock: 3n },
  { warehouseId: 11n, productId: 73n, placementId: 42n, stock: 12n },
  { warehouseId: 11n, productId: 700n, placementId: 41n, stock: 6n },
  { warehouseId: 11n, productId: 702n, placementId: 41n, stock: 4n },
  { warehouseId: 11n, productId: 701n, placementId: 42n, stock: 0n },
  { warehouseId: 14n, productId: 74n, placementId: 44n, stock: 5n },
  { warehouseId: 14n, productId: 74n, placementId: 45n, stock: 3n },
  { warehouseId: 14n, productId: 700n, placementId: 44n, stock: 10n },
  { warehouseId: 14n, productId: 702n, placementId: 45n, stock: 4n },
  { warehouseId: 14n, productId: 73n, placementId: 45n, stock: 12n },
];

const productOf = (id: bigint) => products.find((p) => p.id === id);
const rackCode = (id: bigint) => racks.find((r) => r.id === id)?.code ?? `#${id}`;

function snapshotRow(sessionId: bigint, productId: bigint, placementId: bigint, system: bigint, foundHere: boolean) {
  const product = productOf(productId);
  const row: OpnameRowFixture = {
    id: nextRowId++,
    sessionId,
    teamId: product?.teamId ?? 0n,
    productId,
    sku: product?.sku ?? "",
    name: product?.name ?? `#${productId}`,
    placementId,
    placementCode: rackCode(placementId),
    status: RS.CREATED,
    revealed: false,
    system,
    count: 0n,
    recounted: false,
    countedById: 0n,
    foundHere,
    broken: 0n,
    brokenNote: "",
    lostNote: "",
    surplusNote: "",
  };
  rows.push(row);

  return row;
}

// ── Finalize — the settlement per product ──────────────────────────────────────────────────────────────────────────

interface PostLine {
  type: PT;
  batchId: bigint;
  stockCount: bigint;
  priceUnit: bigint;
  amount: bigint;
  problemId: bigint;
}

// Take `n` units off a product's batches, oldest first, from what is left after `taken` (broken before lost).
function takeOldest(warehouseId: bigint, teamId: bigint, productId: bigint, n: bigint, type: PT, taken: Map<string, bigint>) {
  const lines: PostLine[] = [];
  let left = n;
  for (const b of batches
    .filter((x) => x.warehouseId === warehouseId && x.teamId === teamId && x.productId === productId)
    .sort((a, c) => (a.id < c.id ? -1 : 1))) {
    if (left === 0n) break;
    const used = taken.get(b.id.toString()) ?? 0n;
    const available = b.stock - used;
    if (available <= 0n) continue;
    const q = available < left ? available : left;
    taken.set(b.id.toString(), used + q);
    lines.push({ type, batchId: b.id, stockCount: q, priceUnit: b.priceUnit, amount: q * b.priceUnit, problemId: 0n });
    left -= q;
  }

  return lines;
}

function settle(s: OpnameSessionFixture) {
  const byProduct = new Map<string, OpnameRowFixture[]>();
  for (const r of rowsOf(s.id)) {
    const k = `${r.teamId}:${r.productId}`;
    byProduct.set(k, [...(byProduct.get(k) ?? []), r]);
  }

  const out = [];
  for (const its of byProduct.values()) {
    const first = its[0]!;
    const book = its.reduce((a, r) => a + r.system, 0n);
    const sellable = its.reduce((a, r) => a + r.count, 0n);
    const broken = its.reduce((a, r) => a + r.broken, 0n);
    const rest = sellable - (book - broken);
    const rackChanges = BigInt(its.filter((r) => r.count !== r.system).length);
    if (rackChanges === 0n && broken === 0n) continue;

    const taken = new Map<string, bigint>();
    const lines: PostLine[] = [];
    if (broken > 0n) lines.push(...takeOldest(s.warehouseId, first.teamId, first.productId, broken, PT.BROKEN, taken));
    if (rest < 0n) lines.push(...takeOldest(s.warehouseId, first.teamId, first.productId, -rest, PT.LOST, taken));
    if (rest > 0n) {
      let left = rest;
      for (const p of problems
        .filter((x) => x.warehouseId === s.warehouseId && x.teamId === first.teamId && x.productId === first.productId)
        .sort((a, c) => (a.createdAtUnix < c.createdAtUnix ? -1 : 1))) {
        const open = p.claimable - p.claimed;
        if (left === 0n || open <= 0n) continue;
        const q = open < left ? open : left;
        lines.push({ type: PT.CLAIM, batchId: p.batchId, stockCount: q, priceUnit: p.priceUnit, amount: q * p.priceUnit, problemId: p.id });
        left -= q;
      }
      if (left > 0n) {
        const newest = batches
          .filter((x) => x.warehouseId === s.warehouseId && x.teamId === first.teamId && x.productId === first.productId)
          .sort((a, c) => (a.id > c.id ? -1 : 1))[0];
        const price = newest?.priceUnit ?? 0n;
        lines.push({ type: PT.MINT, batchId: 0n, stockCount: left, priceUnit: price, amount: left * price, problemId: 0n });
      }
    }

    out.push({
      teamId: first.teamId,
      productId: first.productId,
      productSku: first.sku,
      productName: first.name,
      bookCount: book,
      sellableCount: sellable,
      brokenCount: broken,
      restCount: rest,
      rackChangeCount: rackChanges,
      lines,
    });
  }

  return out.sort((a, b) => (a.teamId !== b.teamId ? (a.teamId < b.teamId ? -1 : 1) : a.productName < b.productName ? -1 : 1));
}

function blockOf(s: OpnameSessionFixture): FB {
  if (s.status !== SS.ACTIVE) return FB.NOT_ACTIVE;
  const its = rowsOf(s.id);
  if (its.some((r) => r.status !== RS.COUNTED)) return FB.ROWS_NOT_COUNTED;
  if (its.some((r) => r.countedById === SELF_ID)) return FB.OWN_COUNT;

  return FB.UNSPECIFIED;
}

const sum = (lines: PostLine[], types: PT[]) => lines.filter((l) => types.includes(l.type)).reduce((a, l) => a + l.amount, 0n);

// ── The service ────────────────────────────────────────────────────────────────────────────────────────────────────

export const opnameService: Partial<ServiceImpl<typeof OpnameService>> = {
  opnameSessionList(req) {
    const status = req.filter?.status ?? SS.UNSPECIFIED;
    const matched = sessions
      .filter((s) => s.warehouseId === req.teamId)
      .filter((s) => !status || s.status === status)
      .sort((a, b) => (a.id > b.id ? -1 : 1));

    const { rows: window, pageInfo } = pageOf(matched, req.page);
    const want = req.dataRequest.length === 0 || req.dataRequest.includes(OpnameSessionListDataType.SESSION);
    const mapData = Object.fromEntries(window.map((s) => [s.id.toString(), sessionWire(s)]));

    return {
      items: want ? [{ d: { case: "session" as const, value: { mapData } } }] : [],
      ids: window.map((s) => s.id),
      pageInfo,
    };
  },

  opnameSessionCreate(req) {
    adminOnly();
    if (sessions.some((s) => s.warehouseId === req.teamId && s.status === SS.ACTIVE)) {
      throw precondition("another count of this warehouse is active");
    }

    const target: Record<OpnamePlan, bigint> = {
      [OpnamePlan.UNSPECIFIED]: 0n,
      [OpnamePlan.ALL]: 0n,
      [OpnamePlan.TEAM]: req.filterTeamId,
      [OpnamePlan.PRODUCT]: req.filterProductId,
      [OpnamePlan.PLACEMENT]: req.filterPlacementId,
    };
    if (req.plan !== OpnamePlan.ALL && target[req.plan] === 0n) throw invalid("the plan needs its team, product or rack");

    const shelf = SHELF.filter((x) => x.warehouseId === req.teamId);
    let picked = shelf;
    if (req.plan === OpnamePlan.TEAM) picked = shelf.filter((x) => productOf(x.productId)?.teamId === req.filterTeamId);
    if (req.plan === OpnamePlan.PRODUCT) picked = shelf.filter((x) => x.productId === req.filterProductId);
    if (req.plan === OpnamePlan.PLACEMENT) {
      // A rack plan counts its products everywhere (a-rack-plan-counts-its-products-everywhere).
      const onRack = new Set(shelf.filter((x) => x.placementId === req.filterPlacementId).map((x) => x.productId.toString()));
      picked = shelf.filter((x) => onRack.has(x.productId.toString()));
    }
    if (picked.length === 0) throw precondition("the plan selects no shelf row — nothing to count");

    const session: OpnameSessionFixture = {
      id: nextSessionId++,
      warehouseId: req.teamId,
      status: SS.ACTIVE,
      plan: req.plan,
      createdById: SELF_ID,
      createdAtUnix: now(),
      finalizedById: 0n,
      finalizedAtUnix: 0n,
    };
    sessions.push(session);
    for (const x of picked) snapshotRow(session.id, x.productId, x.placementId, x.stock, false);

    return { session: sessionWire(session) };
  },

  opnameSessionDetail(req) {
    return { session: sessionWire(sessionOf(req.teamId, req.sessionId)) };
  },

  opnameSessionCancel(req) {
    adminOnly();
    const s = activeSessionOf(req.teamId, req.sessionId);
    s.status = SS.CANCEL;

    return { session: sessionWire(s) };
  },

  opnameRowList(req) {
    adminOnly();
    const f = req.filter!;
    sessionOf(req.teamId, f.sessionId);
    const q = (f.q ?? "").trim().toLowerCase();

    const matched = rowsOf(f.sessionId)
      .filter((r) => !f.placementId || r.placementId === f.placementId)
      .filter((r) => !f.status || r.status === f.status)
      .filter((r) => !f.onlyDifferences || differs(r))
      .filter((r) => !q || r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => (a.placementCode !== b.placementCode ? (a.placementCode < b.placementCode ? -1 : 1) : a.name < b.name ? -1 : 1));

    const { rows: window, pageInfo } = pageOf(matched, req.page);
    const want = req.dataRequest.length === 0 || req.dataRequest.includes(OpnameRowListDataType.ROW);
    const mapData = Object.fromEntries(window.map((r) => [r.id.toString(), rowWire(r, false)]));

    return {
      items: want ? [{ d: { case: "row" as const, value: { mapData } } }] : [],
      ids: window.map((r) => r.id),
      pageInfo,
    };
  },

  opnameRowSendBack(req) {
    adminOnly();
    const row = rowOf(req.teamId, req.rowId);
    activeSessionOf(req.teamId, row.sessionId);
    if (row.status !== RS.COUNTED) throw precondition("only a counted row is sent back");

    Object.assign(row, {
      status: RS.CREATED,
      revealed: false,
      count: 0n,
      recounted: false,
      countedById: 0n,
      broken: 0n,
      brokenNote: "",
      lostNote: "",
      surplusNote: "",
    });

    return { row: rowWire(row, false) };
  },

  opnameFinalizePreview(req) {
    adminOnly();
    const s = sessionOf(req.teamId, req.sessionId);
    const products = settle(s);
    const lines = products.flatMap((p) => p.lines);

    return {
      products,
      owedAmount: sum(lines, [PT.BROKEN, PT.LOST]),
      claimedAmount: sum(lines, [PT.CLAIM]),
      mintedAmount: sum(lines, [PT.MINT]),
      block: blockOf(s),
    };
  },

  opnameSessionFinalize(req) {
    adminOnly();
    const s = sessionOf(req.teamId, req.sessionId);
    const block = blockOf(s);
    if (block !== FB.UNSPECIFIED) throw precondition(`finalize refused: ${FB[block]}`);

    const settled = settle(s);
    for (const p of settled) {
      for (const l of p.lines) {
        if (l.type === PT.CLAIM) {
          const problem = problems.find((x) => x.id === l.problemId);
          if (problem) problem.claimed += l.stockCount;
        }
      }
    }
    s.status = SS.FINISH;
    s.finalizedById = SELF_ID;
    s.finalizedAtUnix = now();

    const teams = [...new Set(rowsOf(s.id).map((r) => r.teamId.toString()))].sort();

    return {
      session: sessionWire(s),
      transactions: teams.map((teamId) => ({ transactionId: nextTransactionId++, teamId: BigInt(teamId) })),
    };
  },

  opnameRackList(req) {
    const f = req.filter!;
    const s = sessionOf(req.teamId, f.sessionId);
    const q = (f.q ?? "").trim().toLowerCase();
    const matched = racksOfSession(s).filter((r) => !q || r.code.toLowerCase().includes(q));

    const { rows: window, pageInfo } = pageOf(matched, req.page);
    const want = req.dataRequest.length === 0 || req.dataRequest.includes(OpnameRackListDataType.RACK);
    const mapData = Object.fromEntries(window.map((r) => [r.id.toString(), rackWire(s.id, r)]));

    return {
      items: want ? [{ d: { case: "rack" as const, value: { mapData } } }] : [],
      ids: window.map((r) => r.id),
      pageInfo,
    };
  },

  opnameRackCount(req) {
    const s = sessionOf(req.teamId, req.sessionId);
    const rack = racksOfSession(s).find((r) => r.id === req.placementId);
    if (!rack) throw new ConnectError("rack not in this session", Code.NotFound);

    return {
      rack: rackWire(s.id, rack),
      rows: rowsOf(s.id)
        .filter((r) => r.placementId === req.placementId)
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((r) => rowWire(r, true)),
    };
  },

  opnameRowCount(req) {
    const row = rowOf(req.teamId, req.rowId);
    activeSessionOf(req.teamId, row.sessionId);
    if (row.status === RS.COUNTED) throw precondition("the row is counted — the admin sends it back");
    if (row.recounted) throw precondition("the one recount is used");

    // The first count is the blind one; the second is the recount, which replaces it.
    if (row.revealed) row.recounted = true;
    row.revealed = true;
    row.count = req.count;
    if (row.countedById === 0n) row.countedById = SELF_ID;
    row.broken = 0n;

    return { row: rowWire(row, true) };
  },

  opnameRowMarkCounted(req) {
    const row = rowOf(req.teamId, req.rowId);
    activeSessionOf(req.teamId, row.sessionId);
    if (row.status === RS.COUNTED) throw precondition("the row is counted already");
    if (!row.revealed) throw precondition("count the row first");

    const next = { ...row, broken: req.brokenCount, brokenNote: req.brokenNote.trim(), lostNote: req.lostNote.trim(), surplusNote: req.surplusNote.trim() };
    for (const d of draftsOf(next)) {
      if (d.note === "") throw invalid(`a ${DT[d.type].toLowerCase()} draft needs its reason`);
    }

    Object.assign(row, next, { status: RS.COUNTED, countedById: row.countedById || SELF_ID });

    return { row: rowWire(row, true) };
  },

  opnameRowAddFound(req) {
    const s = activeSessionOf(req.teamId, req.sessionId);
    if (!racksOfSession(s).some((r) => r.id === req.placementId)) throw new ConnectError("rack not in this session", Code.NotFound);
    if (rowsOf(s.id).some((r) => r.productId === req.productId && r.placementId === req.placementId)) {
      throw new ConnectError("the product already has a row on this rack", Code.AlreadyExists);
    }

    const product = productOf(req.productId);
    const stockedHere = batches.some(
      (b) => b.warehouseId === req.teamId && b.productId === req.productId && b.teamId === (product?.teamId ?? 0n),
    );
    if (!stockedHere) throw precondition("its team never had this product in this warehouse");

    const added = [snapshotRow(s.id, req.productId, req.placementId, 0n, true)];
    // Its other racks join the session, so the move nets out (a-counter-may-add-a-product-found-here).
    for (const x of SHELF.filter((y) => y.warehouseId === req.teamId && y.productId === req.productId)) {
      if (!rowsOf(s.id).some((r) => r.productId === x.productId && r.placementId === x.placementId)) {
        added.push(snapshotRow(s.id, x.productId, x.placementId, x.stock, false));
      }
    }

    return { rows: added.map((r) => rowWire(r, true)) };
  },
};
