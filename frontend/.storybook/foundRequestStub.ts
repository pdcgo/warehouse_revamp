// inventory_service's FoundRequestService as Storybook's stub. The server is inventory_v1/found_request_*.go; this plays
// the same rules, so the screens are proven against them:
//   an-adjust-found-waits-for-the-owner-or-admin       a found writes a WAITING request (FoundRequestCreate) and posts nothing.
//   staff-may-report-a-found                           staff report too, and read only their own.
//   nobody-finalizes-their-own-count                   the person who reported it may not approve it.
//   the-reporter-may-withdraw-their-found              the reporter — staff included — may reject their own.
//   a-surplus-claims-the-oldest-loss-first             approval claims the oldest open loss first, into its batch at its price.
//   a-claim-records-its-units                          a loss is claimed up to what is claimable, never twice.
//   last-price-is-the-teams-newest-batch-here          the rest is minted at the team's newest batch price here.
//   a-found-never-stocked-here-is-refused-at-the-report  no batch of it here, ever: the report is refused.
//   a-lock-stops-sales-and-cancels-too                 a counted product on the rack: the report is refused, the approval waits.
//   a-count-settles-the-found-it-counted               a finalized count closes the request it counted (fixture #286).
//   a-found-lost-parcel-is-a-found-stock-in            a found may name a LOST order this warehouse shipped: its product one
//                                                      of the order's lines, its units no more than the line less what the
//                                                      order's founds already report; it claims nothing and mints at the
//                                                      cost the take drew (here: the product's OLDEST batch price), and the
//                                                      order's timeline gets a note naming it (foundOrderNotesOf). The
//                                                      order stays lost.
//
// It also plays StockAdjust for the Adjust dialog: FOUND is refused there, as the server does — FoundRequestCreate is the
// one door.
//
// WRITEABLE: an approval in one step shows in the Approved tab in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  FoundRequestApproveBlock as Block,
  FoundRequestListDataType,
  FoundRequestPostType as PT,
  FoundRequestService,
  FoundRequestStatus as ST,
} from "../src/gen/warehouse/inventory/v1/found_request_pb";
import { StockAdjustReason, type StockAdjustRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { OrderStatus, OrderTimelineFrom } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailFor, products, racks } from "./fixtures";
import { scenarioStatus } from "./returnAcceptStub";
import {
  type FoundBatchFixture,
  type FoundLockFixture,
  type FoundLossFixture,
  type FoundPostedLine,
  type FoundRequestFixture,
  foundBatchFixtures,
  foundLockFixtures,
  foundLossFixtures,
  foundRequestFixtures,
} from "./foundRequestFixtures";
import { sessionScenario } from "./sessionScenario";
import { SELF_ID } from "./userStub";

let requests: FoundRequestFixture[] = [];
let losses: FoundLossFixture[] = [];
let batches: FoundBatchFixture[] = [];
let locks: FoundLockFixture[] = [];
let nextRequestId = 400n;
let nextBatchId = 100n;
let nextTransactionId = 5_100n;

/** What the last FoundRequestCreate carried — a story pins that a found names no batch, and the order it names. */
export const reportScenario = {
  // `orderId` only when it names one — a found of no order reads as it always did.
  last: undefined as undefined | { productId: bigint; rackId: bigint; quantity: bigint; note: string; orderId?: bigint },
};

/** A note a found naming a lost order wrote on the order's timeline — the shape OrderDetail's rows have. */
type FoundOrderNote = {
  id: bigint;
  status: OrderStatus;
  note: string;
  from: OrderTimelineFrom;
  actorId: bigint;
  createdAtUnix: bigint;
};

let foundOrderNotes = new Map<string, FoundOrderNote[]>();
let nextFoundNoteId = 9_500n;

/** The notes founds wrote on an order's timeline — the order detail stub (stubTransport.ts) adds them to its rows. */
export function foundOrderNotesOf(orderId: bigint): FoundOrderNote[] {
  return foundOrderNotes.get(orderId.toString()) ?? [];
}

export function resetFoundRequestStub() {
  requests = structuredClone(foundRequestFixtures);
  losses = structuredClone(foundLossFixtures);
  batches = structuredClone(foundBatchFixtures);
  locks = structuredClone(foundLockFixtures);
  nextRequestId = 400n;
  nextBatchId = 100n;
  nextTransactionId = 5_100n;
  reportScenario.last = undefined;
  foundOrderNotes = new Map();
  nextFoundNoteId = 9_500n;
}

resetFoundRequestStub();

/**
 * A `beforeEach`: order #106 (Melati's, Gudang Pusat — 1 Beras) went lost, and Budi has reported its parcel found on
 * B-02-1 as request #304 — waiting, naming the order (a-found-lost-parcel-is-a-found-stock-in).
 */
export function withFoundFromLostOrder() {
  const beras = foundRequestFixtures.find((r) => r.productId === 74n)!;
  requests.push({
    ...structuredClone(beras),
    id: 304n,
    rackId: 43n,
    rackCode: "B-02-1",
    stockCount: 1n,
    note: "Order #106's parcel came back from the courier's depot",
    reportedById: 62n, // Budi — not Ani, so she may approve it
    reportedAtUnix: now(),
    status: ST.WAITING,
    decidedById: 0n,
    decidedAtUnix: 0n,
    rejectReason: "",
    settledByCountingSessionId: 0n,
    posted: [],
    transactionId: 0n,
    orderId: 106n,
  });
}

/**
 * The products with a batch in this warehouse, emptied ones included — the batch register the never-stocked refusal
 * reads, and so what the warehouse picker may offer (warehouseProductSearchStub.ts). An approved found's mint joins it.
 */
export function foundHeldHere(warehouseId: bigint): bigint[] {
  return batches.filter((b) => b.warehouseId === warehouseId).map((b) => b.productId);
}

/** A `beforeEach`: nothing waits — the Waiting tab is empty and the menu carries no count; the history stays. */
export function foundRequestsNoneWaiting() {
  requests = requests.filter((r) => r.status !== ST.WAITING);
}

const now = () => BigInt(Math.floor(Date.now() / 1000));

// The warehouse's Owner and Admin decide; Root and the Administrator act in every team. Staff report, read their own and
// withdraw them. The admin team's monitor reads every request (NO_SIDE_EFFECTS) and decides nothing.
const DECIDERS = new Set<Role>([Role.ROOT, Role.ADMINISTRATOR, Role.WAREHOUSE_OWNER, Role.WAREHOUSE_ADMIN]);
const isStaff = () => sessionScenario.role === Role.WAREHOUSE_STAFF;
const isMonitor = () => sessionScenario.role === Role.ADMIN_OWNER || sessionScenario.role === Role.ADMIN_ADMINISTRATOR;

function mayRead() {
  if (!DECIDERS.has(sessionScenario.role) && !isStaff() && !isMonitor()) {
    throw new ConnectError("the warehouse Owner's, Admin's or Staff's", Code.PermissionDenied);
  }
}

function mayReport() {
  if (!DECIDERS.has(sessionScenario.role) && !isStaff()) {
    throw new ConnectError("the warehouse Owner's, Admin's or Staff's", Code.PermissionDenied);
  }
}

function mayDecide() {
  if (!DECIDERS.has(sessionScenario.role)) {
    throw new ConnectError("the warehouse Owner's or Admin's", Code.PermissionDenied);
  }
}

function requestOf(warehouseId: bigint, id: bigint): FoundRequestFixture {
  const found = requests.find((r) => r.id === id && r.warehouseId === warehouseId);
  if (!found) throw new ConnectError("found request not found", Code.NotFound);

  return found;
}

const lockOf = (r: { warehouseId: bigint; productId: bigint; rackId: bigint }) =>
  locks.find((l) => l.warehouseId === r.warehouseId && l.productId === r.productId && l.rackId === r.rackId);

// ── What approving would post — the oldest loss first, then the mint ──────────────────────────────────────────────

/**
 * A found naming a lost order: no claim — ONE order mint at the cost the take drew (the stub's take is the product's
 * OLDEST batch here; the server's is the take's own batch rows, oldest first).
 */
function settleOrder(r: FoundRequestFixture): FoundPostedLine[] | undefined {
  const oldest = batches
    .filter((b) => b.warehouseId === r.warehouseId && b.teamId === r.teamId && b.productId === r.productId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (!oldest) return undefined;

  return [
    { type: PT.ORDER_MINT, batchId: 0n, stockCount: r.stockCount, priceUnit: oldest.priceUnit, problemId: 0n, problemCreatedAtUnix: 0n },
  ];
}

/** `undefined` when nothing could post: no loss to claim and the team never had a batch here. */
function settle(r: FoundRequestFixture): FoundPostedLine[] | undefined {
  if (r.orderId) return settleOrder(r);

  const lines: FoundPostedLine[] = [];
  let left = r.stockCount;

  const open = losses
    .filter((l) => l.warehouseId === r.warehouseId && l.teamId === r.teamId && l.productId === r.productId && l.claimed < l.claimable)
    .sort((a, b) => (a.createdAtUnix === b.createdAtUnix ? (a.id < b.id ? -1 : 1) : a.createdAtUnix < b.createdAtUnix ? -1 : 1));
  for (const l of open) {
    if (left === 0n) break;
    const room = l.claimable - l.claimed;
    const q = room < left ? room : left;
    lines.push({ type: PT.CLAIM, batchId: l.batchId, stockCount: q, priceUnit: l.priceUnit, problemId: l.id, problemCreatedAtUnix: l.createdAtUnix });
    left -= q;
  }

  if (left > 0n) {
    const newest = batches
      .filter((b) => b.warehouseId === r.warehouseId && b.teamId === r.teamId && b.productId === r.productId)
      .sort((a, b) => (a.id > b.id ? -1 : 1))[0];
    if (!newest) return undefined;
    lines.push({ type: PT.MINT, batchId: 0n, stockCount: left, priceUnit: newest.priceUnit, problemId: 0n, problemCreatedAtUnix: 0n });
  }

  return lines;
}

function blockOf(r: FoundRequestFixture): Block {
  if (r.status !== ST.WAITING) return Block.NOT_WAITING;
  if (r.reportedById === SELF_ID) return Block.OWN_REPORT;
  if (lockOf(r)) return Block.BEING_COUNTED;

  return Block.UNSPECIFIED;
}

function wire(r: FoundRequestFixture) {
  const lines = r.status === ST.APPROVED ? r.posted : r.status === ST.WAITING ? (settle(r) ?? []) : [];
  const amountOf = (l: FoundPostedLine) => Number(l.stockCount * l.priceUnit);
  const block = blockOf(r);

  return {
    id: r.id,
    warehouseId: r.warehouseId,
    teamId: r.teamId,
    productId: r.productId,
    productCode: r.productCode,
    productName: r.productName,
    rackId: r.rackId,
    rackCode: r.rackCode,
    stockCount: r.stockCount,
    note: r.note,
    reportedById: r.reportedById,
    reportedAtUnix: r.reportedAtUnix,
    status: r.status,
    decidedById: r.decidedById,
    decidedAtUnix: r.decidedAtUnix,
    rejectReason: r.rejectReason,
    settledByCountingSessionId: r.settledByCountingSessionId,
    orderId: r.orderId ?? 0n,
    lines: lines.map((l) => ({ ...l, priceUnit: Number(l.priceUnit), amount: amountOf(l) })),
    claimedAmount: lines.filter((l) => l.type === PT.CLAIM).reduce((a, l) => a + amountOf(l), 0),
    mintedAmount: lines.filter((l) => l.type === PT.MINT || l.type === PT.ORDER_MINT).reduce((a, l) => a + amountOf(l), 0),
    transactionId: r.transactionId,
    block,
    countingSessionId: block === Block.BEING_COUNTED ? (lockOf(r)?.sessionId ?? 0n) : 0n,
  };
}

const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);

const BLOCK_MESSAGE: Record<Block, string> = {
  [Block.UNSPECIFIED]: "",
  [Block.NOT_WAITING]: "the found request is already decided",
  [Block.OWN_REPORT]: "you reported this found — another Owner or Admin approves it",
  [Block.BEING_COUNTED]: "a stock count holds this product on the rack — approve it after the count",
};

const NOT_WAITING = "the found request is no longer waiting — it was approved, rejected or settled by a count";

export const foundRequestService: Partial<ServiceImpl<typeof FoundRequestService>> = {
  foundRequestCreate: (req) => {
    mayReport();
    if (req.productId === 0n || req.rackId === 0n || req.quantity <= 0n) {
      throw new ConnectError("a found names a product, a rack and a positive quantity", Code.InvalidArgument);
    }

    const rack = racks.find((r) => r.id === req.rackId && r.warehouseId === req.teamId && !r.deleted);
    if (!rack) throw new ConnectError("rack not found", Code.NotFound);
    const product = products.find((p) => p.id === req.productId);
    if (!product) throw new ConnectError("product not found", Code.NotFound);

    reportScenario.last = {
      productId: req.productId,
      rackId: req.rackId,
      quantity: req.quantity,
      note: req.note,
      ...(req.orderId > 0n ? { orderId: req.orderId } : {}),
    };

    const lock = lockOf({ warehouseId: req.teamId, productId: req.productId, rackId: req.rackId });
    if (lock) {
      throw precondition(`product ${req.productId} on rack ${rack.code} is being counted — count #${lock.sessionId}`);
    }

    // a-found-never-stocked-here-is-refused-at-the-report — the test the mint's price is found by.
    const stocked = batches.some((b) => b.warehouseId === req.teamId && b.teamId === product.teamId && b.productId === product.id);
    if (!stocked) {
      throw precondition(
        `${product.name} (${product.productCode}) was never stocked here for team #${product.teamId} — bring it in by restock`,
      );
    }

    // A LOST ORDER'S PARCEL (a-found-lost-parcel-is-a-found-stock-in) — the server's refusals, in its order.
    const order = req.orderId > 0n ? orderDetailFor(req.orderId) : undefined;
    if (req.orderId > 0n) {
      if (!order || order.warehouseId !== req.teamId) {
        throw new ConnectError(`no order #${req.orderId} shipped from this warehouse`, Code.NotFound);
      }
      const status = scenarioStatus(order).status;
      if (status !== OrderStatus.LOST) {
        throw precondition(`order #${req.orderId} is ${OrderStatus[status]?.toLowerCase()}, not lost — only a lost order's parcel comes back as a found; a live one comes back as its return`);
      }
      if (order.teamId !== product.teamId) {
        throw precondition(
          `${product.name} (${product.productCode}) is team #${product.teamId}'s and order #${req.orderId} is team #${order.teamId}'s — a found names only its own team's lost order`,
        );
      }
      const taken = order.items.filter((i) => i.productId === product.id).reduce((a, i) => a + BigInt(i.quantity), 0n);
      if (taken === 0n) throw precondition(`the lost order's take never drew this product for its team: product ${product.id} is not in order #${req.orderId}'s take`);
      const reported = requests
        .filter((r) => r.orderId === req.orderId && r.productId === product.id)
        .filter((r) => r.status === ST.WAITING || r.status === ST.APPROVED)
        .reduce((a, r) => a + r.stockCount, 0n);
      if (reported + req.quantity > taken) {
        const left = taken - reported > 0n ? taken - reported : 0n;
        throw precondition(
          `more units than the lost order took: order #${req.orderId} took ${taken} of product ${product.id} and ${reported} are already reported found — ${left} more at most`,
        );
      }
    }

    const request: FoundRequestFixture = {
      id: nextRequestId++,
      warehouseId: req.teamId,
      teamId: product.teamId,
      productId: product.id,
      productCode: product.productCode,
      productName: product.name,
      rackId: rack.id,
      rackCode: rack.code,
      stockCount: req.quantity,
      note: req.note.trim(),
      reportedById: SELF_ID,
      reportedAtUnix: now(),
      status: ST.WAITING,
      decidedById: 0n,
      decidedAtUnix: 0n,
      rejectReason: "",
      settledByCountingSessionId: 0n,
      posted: [],
      transactionId: 0n,
      ...(order ? { orderId: order.id } : {}),
    };
    requests.push(request);

    // THE ORDER'S TIMELINE NAMES THE REQUEST — one note from the warehouse, by the reporter; the order stays lost.
    if (order) {
      const key = order.id.toString();
      foundOrderNotes.set(key, [
        ...(foundOrderNotes.get(key) ?? []),
        {
          id: nextFoundNoteId++,
          status: OrderStatus.UNSPECIFIED,
          note: `Found at the warehouse: ${request.stockCount} × ${request.productCode} ${request.productName} on rack ${request.rackCode} — found request #${request.id}. The order stays lost.`,
          from: OrderTimelineFrom.WAREHOUSE,
          actorId: SELF_ID,
          createdAtUnix: now(),
        },
      ]);
    }

    return { foundRequest: wire(request) };
  },

  foundRequestList: (req) => {
    mayRead();
    const status = req.filter?.status ?? ST.UNSPECIFIED;
    const all = requests
      .filter((r) => r.warehouseId === req.teamId)
      .filter((r) => status === ST.UNSPECIFIED || r.status === status)
      // Staff read only their own — filtered by the server, not the screen.
      .filter((r) => !isStaff() || r.reportedById === SELF_ID)
      .sort((a, b) => (a.reportedAtUnix > b.reportedAtUnix ? -1 : 1));

    const limit = req.page?.limit || 20;
    const current = req.page?.page || 1;
    const window = all.slice((current - 1) * limit, current * limit);
    const wanted = req.dataRequest.length === 0 ? [FoundRequestListDataType.REQUEST] : req.dataRequest;

    return {
      items: wanted.includes(FoundRequestListDataType.REQUEST)
        ? [{ d: { case: "request" as const, value: { mapData: Object.fromEntries(window.map((r) => [r.id.toString(), wire(r)])) } } }]
        : [],
      ids: window.map((r) => r.id),
      pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(all.length / limit)), totalItems: BigInt(all.length) },
    };
  },

  foundRequestApprove: (req) => {
    mayDecide();
    const r = requestOf(req.teamId, req.foundRequestId);
    const block = blockOf(r);
    if (block !== Block.UNSPECIFIED) throw precondition(BLOCK_MESSAGE[block]);

    // The register under lock: claim each loss, then mint the rest as a batch of its own. The report refuses a product
    // never stocked here, so no price is the backstop only.
    const lines = settle(r);
    if (lines === undefined) throw precondition("nothing to claim and the team never had a batch of this product here — it cannot post");
    for (const line of lines) {
      if (line.type === PT.CLAIM) {
        const loss = losses.find((l) => l.id === line.problemId)!;
        loss.claimed += line.stockCount;
      } else {
        const batch = { id: nextBatchId++, warehouseId: r.warehouseId, teamId: r.teamId, productId: r.productId, priceUnit: line.priceUnit };
        batches.push(batch);
        line.batchId = batch.id;
      }
    }

    r.status = ST.APPROVED;
    r.decidedById = SELF_ID;
    r.decidedAtUnix = now();
    r.posted = lines;
    r.transactionId = nextTransactionId++;

    return { foundRequest: wire(r), transactionId: r.transactionId };
  },

  // A rejection — or the reporter's withdrawal (the-reporter-may-withdraw-their-found): staff only their own.
  foundRequestReject: (req) => {
    mayReport();
    const r = requestOf(req.teamId, req.foundRequestId);
    if (req.reason.trim() === "") throw new ConnectError("a rejection says why — the reporter reads it", Code.InvalidArgument);
    if (isStaff() && r.reportedById !== SELF_ID) {
      throw new ConnectError(
        "staff withdraw only the founds they reported — the warehouse Owner or Admin rejects the rest",
        Code.PermissionDenied,
      );
    }
    if (r.status !== ST.WAITING) throw precondition(NOT_WAITING);

    r.status = ST.REJECTED;
    r.decidedById = SELF_ID;
    r.decidedAtUnix = now();
    r.rejectReason = req.reason.trim();

    return { foundRequest: wire(r) };
  },
};

// ── The Adjust dialog's side ──────────────────────────────────────────────────────────────────────────────────────

/**
 * InventoryService.StockAdjust. FOUND is refused, as the server does — a found is reported through FoundRequestCreate
 * (the dialog calls that). A counted rack refuses every adjustment; the rest answer a movement.
 */
export function stockAdjust(req: StockAdjustRequest) {
  const rackId = req.place.case === "rackId" ? req.place.value : 0n;

  if (req.reasonType === StockAdjustReason.FOUND) {
    throw new ConnectError(
      "a found is reported with FoundRequestService.FoundRequestCreate — it waits for the warehouse Owner or Admin and posts nothing until approved",
      Code.InvalidArgument,
    );
  }

  const lock = lockOf({ warehouseId: req.warehouseId, productId: req.productId, rackId });
  if (lock) {
    throw precondition(`stock count #${lock.sessionId} is counting this product on this rack — adjust it after the count`);
  }

  const delta = req.reasonType === StockAdjustReason.RECOUNT ? 0n : -req.quantity;

  return {
    movement: { id: 1n, productId: req.productId, warehouseId: req.warehouseId, delta, rackId, batchId: req.batchId, reason: req.reason },
    level: { productId: req.productId, warehouseId: req.warehouseId, onHand: 0n },
  };
}

/** InventoryService.BatchList for one product — what Damaged and Lost pick a batch from. */
export function batchList(req: { teamId: bigint; filter?: { productId: bigint } }) {
  const productId = req.filter?.productId ?? 0n;
  const its = batches.filter((b) => b.warehouseId === req.teamId && (productId === 0n || b.productId === productId));

  return {
    items: [
      {
        d: {
          case: "batch" as const,
          value: {
            mapData: Object.fromEntries(
              its.map((b) => [b.id.toString(), { id: b.id, deliveryId: b.id + 1000n, productId: b.productId, unitCost: Number(b.priceUnit), costKnown: true, ready: 3n }]),
            ),
          },
        },
      },
    ],
    ids: its.map((b) => b.id),
    pageInfo: { currentPage: 1, totalPage: 1, totalItems: BigInt(its.length) },
  };
}
