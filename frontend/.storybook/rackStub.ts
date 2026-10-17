// inventory_service's RackService as Storybook's stub: the registry the Racks page lists and edits (RackList, RackCreate,
// RackUpdate, RackDelete — as the real server answers them), the reads behind Rack detail, and its two PROTOTYPE writes —
// RackMove and RackSample. The real server answers the writes Unimplemented until design_accept, so this is their only
// implementation; the reads are here because Rack detail had never been in Storybook.
//
// It plays the DECIDED rules (docs/business/inventory/placement_decision.md, transaction_decision.md):
//   a-move-is-one-rack-to-one-or-more-racks          from one rack of this warehouse to one or more others; never back
//                                                     onto itself; a product may be split, never twice to one rack.
//   a-move-is-all-or-nothing                          any line that does not fit refuses the WHOLE write, naming the
//                                                     product; a product being counted cannot move.
//   a-move-leaves-sold-units-on-their-rack            a line takes at most the rack's stock count.
//   a-move-writes-one-transaction-per-owning-team     one transaction per owning team, in team id order.
//   a-move-writes-two-rack-rows-and-no-batch-row      a row per rack touched, kind MOVE; no batch rows.
//   a-sample-names-the-rack-it-was-taken-from         a sample takes from the request's rack; kind SAMPLE.
//   a-rack-shows-its-stock-count-for-now              `on_hand` is the stock count, nothing else; RackList's STOCK
//                                                     slice sums it per rack and counts its products.
//   (the built registry)                              a code is unique among the warehouse's undeleted racks
//                                                     (AlreadyExists); a rack holding stock cannot be deleted.
//
// WRITEABLE: a move made in one step is on the shelf in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { MovementKind } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

import {
  RackListDataType,
  type RackListResponseItemSchema,
  type RackService,
} from "../src/gen/warehouse/inventory/v1/rack_pb";
import { products, racks } from "./fixtures";
import { SELF_ID } from "./userStub";

interface ShelfLine {
  productId: bigint;
  onHand: bigint;
  unitCost: bigint;
  // A count holds it (a-count-locks-the-product-on-the-rack). The real server never sets this until opname exists.
  counting: boolean;
}

interface Movement {
  id: bigint;
  productId: bigint;
  warehouseId: bigint;
  rackId: bigint;
  delta: bigint;
  balance: bigint;
  kind: MovementKind;
  reason: string;
  ref: string;
  createdAt: string;
}

export interface RackWrite {
  kind: "move" | "sample";
  transactions: { transactionId: bigint; teamId: bigint }[];
}

// Gudang Pusat (11) holds three teams' goods on A-01-1 — its own coffee (71), Kenanga's sugar (73) and Melati's rice
// (74) — so a move off it writes three transactions. A-01-2 holds tea (72) that a count is holding. B-02-1 is empty.
const SHELVES: Record<string, ShelfLine[]> = {
  "41": [
    { productId: 71n, onHand: 12n, unitCost: 18500n, counting: false },
    { productId: 73n, onHand: 5n, unitCost: 14000n, counting: false },
    { productId: 74n, onHand: 8n, unitCost: 65000n, counting: false },
  ],
  "42": [
    { productId: 71n, onHand: 6n, unitCost: 18500n, counting: false },
    { productId: 72n, onHand: 3n, unitCost: 9000n, counting: true },
  ],
  "43": [],
  "44": [{ productId: 74n, onHand: 4n, unitCost: 65000n, counting: false }],
  "45": [],
};

const RECEIVED_AT = "2026-10-01T09:00:00Z";

function receivedMovements(): Movement[] {
  let id = 9000n;
  const out: Movement[] = [];

  for (const [rackId, lines] of Object.entries(SHELVES)) {
    const rack = racks.find((r) => r.id.toString() === rackId)!;
    for (const line of lines) {
      out.push({
        id: id++,
        productId: line.productId,
        warehouseId: rack.warehouseId,
        rackId: rack.id,
        delta: line.onHand,
        balance: line.onHand,
        kind: MovementKind.RECEIVE,
        reason: "",
        ref: "",
        createdAt: RECEIVED_AT,
      });
    }
  }

  return out;
}

type RackRow = (typeof racks)[number];
type RackListItemInit = MessageInitShape<typeof RackListResponseItemSchema>;

// The registry, writeable: a rack created in one step is listed in the next. Copied from the shared fixture, which other
// stubs read for codes and must not see a story's edits.
let rackRows: RackRow[] = [];
let nextRackId = 100n;
let shelves: Record<string, ShelfLine[]> = {};
let movements: Movement[] = [];
let nextMovementId = 9100n;
let nextTransactionId = 7001n;
let last: RackWrite | null = null;

/**
 * A RACE, armed for the next write only: just before RackMove or RackSample checks the shelf, somebody else has taken
 * units, so `productId` on `rackId` holds `onHand`. The dialog allowed the quantity; the server refuses the whole write.
 */
export const rackStubScenario: { raceBeforeNextWrite: { rackId: bigint; productId: bigint; onHand: bigint } | null } = {
  raceBeforeNextWrite: null,
};

export function resetRackStub() {
  rackRows = structuredClone(racks);
  nextRackId = 100n;
  shelves = structuredClone(SHELVES);
  movements = receivedMovements();
  nextMovementId = 9100n;
  nextTransactionId = 7001n;
  last = null;
  rackStubScenario.raceBeforeNextWrite = null;
}

resetRackStub();

/** What `productId` holds on `rackId` now — 0 when it is not there. For a story to assert a write landed. */
export function rackShelf(rackId: bigint, productId: bigint): bigint {
  return shelves[rackId.toString()]?.find((l) => l.productId === productId)?.onHand ?? 0n;
}

/** The last successful RackMove or RackSample, as the server answered it. */
export function lastRackWrite(): RackWrite | null {
  return last;
}

/** The registry as the stub holds it now — for a story to assert a create, an edit or a delete landed. */
export function rackRow(warehouseId: bigint, code: string): RackRow | undefined {
  return rackRows.find((r) => r.warehouseId === warehouseId && r.code === code && !r.deleted);
}

const notFound = () => new ConnectError("rack not found", Code.NotFound);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);

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

// The scope IS the where clause: another warehouse's rack, or a deleted one, reads NotFound.
function visibleRack(teamId: bigint, rackId: bigint) {
  const rack = rackRows.find((r) => r.id === rackId && r.warehouseId === teamId && !r.deleted);
  if (!rack) throw notFound();

  return rack;
}

function shelfOf(rackId: bigint): ShelfLine[] {
  const key = rackId.toString();
  shelves[key] ??= [];

  return shelves[key]!;
}

const productName = (id: bigint) => products.find((p) => p.id === id)?.name ?? `product #${id}`;
const ownerOf = (id: bigint) => products.find((p) => p.id === id)?.teamId ?? 0n;

function applyRace() {
  const race = rackStubScenario.raceBeforeNextWrite;
  if (!race) return;

  rackStubScenario.raceBeforeNextWrite = null;
  const line = shelfOf(race.rackId).find((l) => l.productId === race.productId);
  if (line) line.onHand = race.onHand;
}

// One transaction per owning team among the products, in team id order (a-move-writes-one-transaction-per-owning-team).
function transactionsFor(productIds: bigint[]) {
  const teams = [...new Set(productIds.map(ownerOf))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const byTeam = new Map<bigint, bigint>();
  const transactions = teams.map((teamId) => {
    const transactionId = nextTransactionId++;
    byTeam.set(teamId, transactionId);
    return { transactionId, teamId };
  });

  return { transactions, refOf: (productId: bigint) => `tx-${byTeam.get(ownerOf(productId))}` };
}

function write(
  rack: RackRow,
  productId: bigint,
  delta: bigint,
  kind: MovementKind,
  reason: string,
  ref: string,
) {
  const shelf = shelfOf(rack.id);
  let line = shelf.find((l) => l.productId === productId);
  if (!line) {
    const cost = Object.values(shelves)
      .flat()
      .find((l) => l.productId === productId)?.unitCost;
    line = { productId, onHand: 0n, unitCost: cost ?? 0n, counting: false };
    shelf.push(line);
  }

  line.onHand += delta;
  movements.push({
    id: nextMovementId++,
    productId,
    warehouseId: rack.warehouseId,
    rackId: rack.id,
    delta,
    balance: line.onHand,
    kind,
    reason,
    ref,
    createdAt: new Date().toISOString(),
  });
}

const stockOnRack = (rackId: bigint) => shelfOf(rackId).reduce((acc, l) => acc + (l.onHand > 0n ? l.onHand : 0n), 0n);
const productsOnRack = (rackId: bigint) => shelfOf(rackId).filter((l) => l.onHand > 0n).length;

const duplicateCode = () => new ConnectError("a rack with this code already exists in this warehouse", Code.AlreadyExists);

function codeTaken(warehouseId: bigint, code: string, except?: bigint) {
  return rackRows.some((r) => r.warehouseId === warehouseId && r.code === code && !r.deleted && r.id !== except);
}

export const rackService: Partial<ServiceImpl<typeof RackService>> = {
  // Scoped by the warehouse, undeleted, `q` on code or name, ordered by code — as the server answers it. The STOCK slice
  // is each rack's stock count, and only when asked for (a picker asks for RACK alone).
  rackList: (req) => {
    const q = (req.filter?.q ?? "").trim().toLowerCase();
    const all = rackRows
      .filter((r) => r.warehouseId === req.teamId && !r.deleted)
      .filter((r) => q === "" || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));
    const { rows, pageInfo } = pageOf(all, req.page as PageReq);
    const types = req.dataRequest.length > 0 ? req.dataRequest : [RackListDataType.RACK];

    const items = types.flatMap((type): RackListItemInit[] => {
      switch (type) {
        case RackListDataType.GENERAL:
          return [{ d: { case: "general" as const, value: { mapData: Object.fromEntries(rows.map((r) => [r.id.toString(), { id: r.id, name: r.code }])) } } }];
        case RackListDataType.RACK:
          return [{ d: { case: "rack" as const, value: { mapData: Object.fromEntries(rows.map((r) => [r.id.toString(), r])) } } }];
        case RackListDataType.STOCK:
          return [
            {
              d: {
                case: "stock" as const,
                value: {
                  mapData: Object.fromEntries(
                    rows.map((r) => [
                      r.id.toString(),
                      { rackId: r.id, stockCount: stockOnRack(r.id), productCount: productsOnRack(r.id) },
                    ]),
                  ),
                },
              },
            },
          ];
        default:
          return [];
      }
    });

    return { items, ids: rows.map((r) => r.id), pageInfo };
  },

  rackCreate: (req) => {
    if (codeTaken(req.teamId, req.code)) throw duplicateCode();

    const rack: RackRow = {
      id: nextRackId++,
      warehouseId: req.teamId,
      code: req.code,
      name: req.name,
      description: req.description,
      deleted: false,
    };
    rackRows.push(rack);

    return { rack };
  },

  rackUpdate: (req) => {
    const rack = visibleRack(req.teamId, req.rackId);
    if (req.code !== undefined && codeTaken(req.teamId, req.code, rack.id)) throw duplicateCode();

    if (req.code !== undefined) rack.code = req.code;
    if (req.name !== undefined) rack.name = req.name;
    if (req.description !== undefined) rack.description = req.description;

    return { rack };
  },

  // Soft, and refused while the rack holds stock — the server's own words, which now point at Move Goods.
  rackDelete: (req) => {
    const rack = visibleRack(req.teamId, req.rackId);
    if (stockOnRack(rack.id) > 0n) {
      throw precondition("this rack still holds stock — move it off the rack first");
    }

    rack.deleted = true;

    return {};
  },

  rackDetail: (req) => {
    const rack = visibleRack(req.teamId, req.rackId);
    const lines = shelfOf(rack.id).filter((l) => l.onHand > 0n);
    const counted = movements
      .filter((m) => m.rackId === rack.id && m.kind === MovementKind.ADJUST)
      .map((m) => m.createdAt)
      .sort()
      .at(-1);

    return {
      rack,
      summary: {
        totalOnHand: lines.reduce((acc, l) => acc + l.onHand, 0n),
        totalValue: lines.reduce((acc, l) => acc + l.onHand * l.unitCost, 0n),
        unknownCostProducts: lines.filter((l) => l.unitCost === 0n).length,
        lastCountedAt: counted ?? "",
      },
    };
  },

  rackStock: (req) => {
    const rack = visibleRack(req.teamId, req.filter?.rackId ?? 0n);
    const all = shelfOf(rack.id)
      .filter((l) => l.onHand > 0n)
      .sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const { rows, pageInfo } = pageOf(all, req.page as PageReq);

    return {
      items: [
        {
          d: {
            case: "rackStock",
            value: {
              mapData: Object.fromEntries(
                rows.map((l) => [
                  l.productId.toString(),
                  {
                    productId: l.productId,
                    onHand: l.onHand,
                    unitCost: l.unitCost,
                    costKnown: l.unitCost > 0n,
                    value: l.onHand * l.unitCost,
                    counting: l.counting,
                  },
                ]),
              ),
            },
          },
        },
      ],
      ids: rows.map((l) => l.productId),
      pageInfo,
    };
  },

  rackHistory: (req) => {
    const rack = visibleRack(req.teamId, req.filter?.rackId ?? 0n);
    const kinds = req.filter?.kinds ?? [];
    const all = movements
      .filter((m) => m.rackId === rack.id && (kinds.length === 0 || kinds.includes(m.kind)))
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    const { rows, pageInfo } = pageOf(all, req.page as PageReq);

    return {
      items: [
        {
          d: {
            case: "movement",
            value: {
              mapData: Object.fromEntries(
                rows.map((m) => [m.id.toString(), { ...m, actorUserId: SELF_ID, batchId: 0n }]),
              ),
            },
          },
        },
      ],
      ids: rows.map((m) => m.id),
      pageInfo,
    };
  },

  rackMove: (req) => {
    const from = visibleRack(req.teamId, req.fromRackId);
    if (req.lines.length === 0) throw invalid("a move needs at least one line");

    const seen = new Set<string>();
    const totals = new Map<bigint, bigint>();
    for (const line of req.lines) {
      if (line.quantity <= 0n) throw invalid("a line moves at least one unit");
      if (line.toRackId === from.id) throw invalid(`${from.code} is the rack the goods leave — a move never goes back onto it`);
      // Another warehouse's rack is not a destination: a move never leaves the building (that is a transfer).
      if (!rackRows.some((r) => r.id === line.toRackId && r.warehouseId === req.teamId && !r.deleted)) {
        throw invalid(`rack #${line.toRackId} is not a rack of this warehouse`);
      }

      const pair = `${line.productId}:${line.toRackId}`;
      if (seen.has(pair)) throw invalid(`${productName(line.productId)} goes to one rack twice — put it on one line`);
      seen.add(pair);

      totals.set(line.productId, (totals.get(line.productId) ?? 0n) + line.quantity);
    }

    applyRace();

    // ALL OR NOTHING: every line is checked before anything is written.
    for (const [productId, total] of totals) {
      const line = shelfOf(from.id).find((l) => l.productId === productId);
      if (line?.counting) {
        throw precondition(`${productName(productId)} is being counted on ${from.code} — nothing was moved`);
      }
      const onHand = line?.onHand ?? 0n;
      if (total > onHand) {
        throw precondition(`${productName(productId)}: only ${onHand} on ${from.code} — nothing was moved`);
      }
    }

    const { transactions, refOf } = transactionsFor([...totals.keys()]);
    for (const [productId, total] of totals) {
      write(from, productId, -total, MovementKind.MOVE, req.description, refOf(productId));
    }
    for (const line of req.lines) {
      const to = rackRows.find((r) => r.id === line.toRackId)!;
      write(to, line.productId, line.quantity, MovementKind.MOVE, req.description, refOf(line.productId));
    }

    last = { kind: "move", transactions };
    return { transactions };
  },

  rackSample: (req) => {
    const rack = visibleRack(req.teamId, req.rackId);
    if (req.lines.length === 0) throw invalid("a sample needs at least one line");
    if (req.recipient.trim() === "") throw invalid("say who received the sample");

    const seen = new Set<bigint>();
    for (const line of req.lines) {
      if (line.quantity <= 0n) throw invalid("a line gives at least one unit");
      if (seen.has(line.productId)) throw invalid(`${productName(line.productId)} is on the sample twice`);
      seen.add(line.productId);
    }

    applyRace();

    for (const line of req.lines) {
      const shelfLine = shelfOf(rack.id).find((l) => l.productId === line.productId);
      if (shelfLine?.counting) {
        throw precondition(`${productName(line.productId)} is being counted on ${rack.code} — nothing was recorded`);
      }
      const onHand = shelfLine?.onHand ?? 0n;
      if (line.quantity > onHand) {
        throw precondition(`${productName(line.productId)}: only ${onHand} on ${rack.code} — nothing was recorded`);
      }
    }

    const { transactions, refOf } = transactionsFor(req.lines.map((l) => l.productId));
    const reason = req.description ? `${req.recipient} — ${req.description}` : req.recipient;
    for (const line of req.lines) {
      write(rack, line.productId, -line.quantity, MovementKind.SAMPLE, reason, refOf(line.productId));
    }

    last = { kind: "sample", transactions };
    return { transactions };
  },
};
