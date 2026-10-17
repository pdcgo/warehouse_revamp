// inventory_service's WarehouseTransferService as Storybook's stub — the ONLY implementation the transfer has until the
// backend step (the real server answers Unimplemented).
//
// It plays the DECIDED rules (docs/business/inventory/warehouse_transfer_decision.md), because the screens must
// already honour them:
//   the-team-opens-the-sender-ships-the-receiver-accepts   Create/Update/Cancel/MarkLost are the owning team's;
//                                                           Process/Ship are A's; Arrive/Accept are B's. The wrong
//                                                           side reads NotFound, never "forbidden".
//   a-transfer-takes-from-the-sender-at-create              too few at A fails the create; the pick list is chosen
//   a-transfer-never-goes-to-its-own-warehouse              A = B is refused.
//   a-product-appears-once-per-transfer                     a product twice is refused; one problem row per kind.
//   cancel-before-processed-lost-only-in-transit            Cancel from created only; MarkLost from shipped only.
//   a-transfer-has-seven-statuses                           Process from created, Ship from process, Arrive from
//                                                           shipped or lost, Accept from shipped or arrived.
//   a-transfer-names-its-paying-account                     a cost above 0 needs an account.
//   the-shipping-expense-reaches-the-account-by-event       the cost is editable until accepted.
//   the-on-site-charge-is-paid-by-b-at-accept               a charge above 0 needs its note.
//   the-system-fills-a-transfers-prices                     line totals and problem prices are worked out here.
//   every-transfer-status-change-is-logged                  every status change appends a trail row.
//
// WRITEABLE: a transfer opened in one step is on the list in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  WarehouseTransferDirection,
  WarehouseTransferListDataType,
  WarehouseTransferProblemType,
  WarehouseTransferService,
  WarehouseTransferStatus as S,
} from "../src/gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { products, racks, warehouseStock } from "./fixtures";
import { type TransferFixture, type TransferLineFixture, transferFixtures } from "./warehouseTransferFixtures";
import { SELF_ID } from "./userStub";

let rows: TransferFixture[] = [];

export function resetWarehouseTransferStub() {
  rows = structuredClone(transferFixtures);
}

resetWarehouseTransferStub();

const now = () => BigInt(Math.floor(Date.now() / 1000));

// The one building the fixture stock is held in (stubTransport's stockAvailability answers the same).
const STOCKED_WAREHOUSE = 11n;

// What a unit is worth when the stub opens a NEW transfer. The real server prices each unit from the batch it comes
// off; the stub has no batches, so it uses one price per product — enough to show a value that is filled, not typed.
const STUB_PRICE: Record<string, bigint> = { "74": 65000n, "71": 40000n, "72": 15000n, "73": 12000n };

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

const notFound = () => new ConnectError("warehouse transfer not found", Code.NotFound);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

// Any side may READ: the owning team, A or B. A fourth team reads NotFound.
function visible(teamId: bigint, id: bigint): TransferFixture {
  const found = rows.find(
    (r) => r.id === id && (r.teamId === teamId || r.fromWarehouseId === teamId || r.toWarehouseId === teamId),
  );
  if (!found) throw notFound();

  return found;
}

const ownedBy = (teamId: bigint, id: bigint) => {
  const found = rows.find((r) => r.id === id && r.teamId === teamId);
  if (!found) throw notFound();
  return found;
};

const sentBy = (teamId: bigint, id: bigint) => {
  const found = rows.find((r) => r.id === id && r.fromWarehouseId === teamId);
  if (!found) throw notFound();
  return found;
};

const comingTo = (teamId: bigint, id: bigint) => {
  const found = rows.find((r) => r.id === id && r.toWarehouseId === teamId);
  if (!found) throw notFound();
  return found;
};

function move(r: TransferFixture, to: S, description = "") {
  const from = r.status;
  const id = r.logs.reduce((max, l) => (l.id > max ? l.id : max), 0n) + 1n;
  r.logs.push({ id, fromStatus: from, toStatus: to, actorUserId: SELF_ID, description, atUnix: now() });
  r.status = to;
}

// The transfer as the wire carries it — display prices worked out, the total summed, the trail only when asked.
function toWire(r: TransferFixture, withLogs: boolean) {
  const items = r.items.map((l) => ({
    ...l,
    priceUnit: l.count > 0n ? l.total / l.count : 0n,
    problems: l.problems.map((p) => ({ ...p, priceUnit: p.count > 0n ? p.total / p.count : 0n })),
  }));

  return {
    ...r,
    items,
    total: r.items.reduce((sum, l) => sum + l.total, 0n),
    logs: withLogs ? r.logs : [],
  };
}

/** One transfer as the wire carries it, trail included — for a component story. Read from the LIVE table. */
export function transferWire(id: bigint) {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no transfer ${id}`);

  return toWire(found, true);
}

function requireAccount(cost: bigint, accountId: bigint) {
  if (cost > 0n && accountId === 0n) throw invalid("finance_account_id: required when shipment_cost is above 0");
}

export const warehouseTransferService: Partial<ServiceImpl<typeof WarehouseTransferService>> = {
  warehouseTransferCreate(req) {
    if (req.lines.length === 0) throw invalid("lines: at least one line is required");
    if (req.fromWarehouseId === req.toWarehouseId) throw invalid("a transfer never goes to its own warehouse");
    requireAccount(req.shipmentCost, req.financeAccountId);

    const seen = new Set<string>();
    for (const l of req.lines) {
      if (seen.has(l.productId.toString())) throw invalid("a product appears once per transfer");
      seen.add(l.productId.toString());
    }

    // Too few at A fails the create and writes nothing (a-shelf-never-goes-below-zero).
    for (const l of req.lines) {
      const held = req.fromWarehouseId === STOCKED_WAREHOUSE ? (warehouseStock[l.productId.toString()] ?? 0n) : 0n;
      if (l.count > held) {
        throw precondition(`not enough stock at the sending warehouse: product ${l.productId} holds ${held}`);
      }
    }

    // The pick list — the stub knows no rack's count, so it takes everything from A's first rack.
    const firstRack = racks.find((rack) => rack.warehouseId === req.fromWarehouseId);
    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const items: TransferLineFixture[] = req.lines.map((l, i) => {
      const product = products.find((p) => p.id === l.productId);

      return {
        id: id * 10n + BigInt(i + 1),
        productId: l.productId,
        sku: product?.sku ?? "",
        name: product?.name ?? "",
        count: l.count,
        total: (STUB_PRICE[l.productId.toString()] ?? 0n) * l.count,
        picks: firstRack ? [{ placementId: firstRack.id, quantity: l.count }] : [],
        arrivedCount: 0n,
        placements: [],
        problems: [],
      };
    });

    const r: TransferFixture = {
      id,
      teamId: req.teamId,
      fromWarehouseId: req.fromWarehouseId,
      toWarehouseId: req.toWarehouseId,
      status: S.UNSPECIFIED,
      note: req.note,
      items,
      shipmentId: 0n,
      receipt: "",
      receiptFile: "",
      shipmentCost: req.shipmentCost,
      financeAccountId: req.shipmentCost > 0n ? req.financeAccountId : 0n,
      warehouseAdditionalCost: 0n,
      warehouseAdditionalCostNote: "",
      outboundTransactionId: 9000n + id,
      inboundTransactionId: 0n,
      createdByUserId: SELF_ID,
      createdAtUnix: now(),
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
    };
    move(r, S.CREATED);
    rows.push(r);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferList(req) {
    const f = req.filter;
    const q = (f?.q ?? "").trim().toLowerCase();
    const idQuery = q.replace(/^#/, "");

    const matched = rows
      .filter((r) => r.teamId === req.teamId || r.fromWarehouseId === req.teamId || r.toWarehouseId === req.teamId)
      .filter((r) => {
        if (f?.direction === WarehouseTransferDirection.OUTGOING) return r.fromWarehouseId === req.teamId;
        if (f?.direction === WarehouseTransferDirection.INCOMING) return r.toWarehouseId === req.teamId;
        return true;
      })
      .filter((r) => !f?.status || r.status === f.status)
      .filter((r) => !f?.warehouseId || r.fromWarehouseId === f.warehouseId || r.toWarehouseId === f.warehouseId)
      .filter((r) => !f?.ownerTeamId || r.teamId === f.ownerTeamId)
      .filter(
        (r) =>
          !q ||
          r.id.toString() === idQuery ||
          r.receipt.toLowerCase().includes(q) ||
          r.items.some((l) => l.sku.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.id > b.id ? -1 : 1));

    const { rows: window, pageInfo } = pageOf(matched, req.page);
    const wantRows =
      req.dataRequest.length === 0 || req.dataRequest.includes(WarehouseTransferListDataType.WAREHOUSE_TRANSFER);
    const mapData = Object.fromEntries(window.map((r) => [r.id.toString(), toWire(r, false)]));

    return {
      items: wantRows ? [{ d: { case: "warehouseTransfer" as const, value: { mapData } } }] : [],
      ids: window.map((r) => r.id),
      pageInfo,
    };
  },

  warehouseTransferDetail(req) {
    return { transfer: toWire(visible(req.teamId, req.transferId), true) };
  },

  warehouseTransferUpdate(req) {
    const r = ownedBy(req.teamId, req.transferId);
    if (r.status === S.ACCEPTED || r.status === S.CANCELLED) {
      throw precondition("the cost can only change until the transfer is accepted");
    }
    requireAccount(req.shipmentCost, req.financeAccountId);

    r.shipmentCost = req.shipmentCost;
    r.financeAccountId = req.shipmentCost > 0n ? req.financeAccountId : 0n;
    r.note = req.note;

    return { transfer: toWire(r, true) };
  },

  warehouseTransferCancel(req) {
    const r = ownedBy(req.teamId, req.transferId);
    if (r.status !== S.CREATED) throw precondition("a transfer is cancelled only while created");

    r.cancelledByUserId = SELF_ID;
    r.cancelledAtUnix = now();
    move(r, S.CANCELLED, req.description);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferMarkLost(req) {
    const r = ownedBy(req.teamId, req.transferId);
    if (r.status !== S.SHIPPED) throw precondition("a transfer is set lost only while shipped");

    r.lostByUserId = SELF_ID;
    r.lostAtUnix = now();
    move(r, S.LOST, req.description);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferProcess(req) {
    const r = sentBy(req.teamId, req.transferId);
    if (r.status !== S.CREATED) throw precondition("a transfer is processed only from created");

    r.processedByUserId = SELF_ID;
    r.processedAtUnix = now();
    move(r, S.PROCESS);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferShip(req) {
    const r = sentBy(req.teamId, req.transferId);
    if (r.status !== S.PROCESS) throw precondition("a transfer is shipped only from process");

    r.shipmentId = req.shipmentId;
    r.receipt = req.receipt;
    r.receiptFile = req.receiptFile;
    r.shippedByUserId = SELF_ID;
    r.shippedAtUnix = now();
    move(r, S.SHIPPED, req.receipt);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferArrive(req) {
    const r = comingTo(req.teamId, req.transferId);
    if (r.status !== S.SHIPPED && r.status !== S.LOST) {
      throw precondition("a box is signed for only while shipped or lost");
    }

    r.arrivedByUserId = SELF_ID;
    r.arrivedAtUnix = now();
    move(r, S.ARRIVED);

    return { transfer: toWire(r, true) };
  },

  warehouseTransferAccept(req) {
    const r = comingTo(req.teamId, req.transferId);
    if (r.status !== S.SHIPPED && r.status !== S.ARRIVED) {
      throw precondition("a transfer is accepted only from shipped or arrived");
    }
    if (req.warehouseAdditionalCost > 0n && req.warehouseAdditionalCostNote.trim() === "") {
      throw invalid("warehouse_additional_cost_note: required when the charge is above 0");
    }

    // EVERY line exactly once — accepting is the count.
    const byItem = new Map(req.lines.map((l) => [l.itemId.toString(), l]));
    if (byItem.size !== req.lines.length || r.items.some((item) => !byItem.has(item.id.toString()))) {
      throw invalid("lines: every line must be counted exactly once");
    }

    const ownRacks = new Set(racks.filter((rack) => rack.warehouseId === r.toWarehouseId).map((rack) => rack.id));

    for (const item of r.items) {
      const counted = byItem.get(item.id.toString())!;
      if (counted.arrivedCount > item.count) throw invalid(`${item.sku}: more arrived than was sent`);
      if (counted.brokenCount > counted.arrivedCount) throw invalid(`${item.sku}: more broken than arrived`);

      const good = counted.arrivedCount - counted.brokenCount;
      const placed = counted.placements.reduce((sum, p) => sum + p.quantity, 0n);
      if (placed !== good) throw invalid(`${item.sku}: the good units must all be put away, exactly`);
      if (counted.placements.some((p) => !ownRacks.has(p.placementId))) throw notFound();
    }

    for (const item of r.items) {
      const counted = byItem.get(item.id.toString())!;
      const price = item.count > 0n ? item.total / item.count : 0n;
      const missing = item.count - counted.arrivedCount;

      item.arrivedCount = counted.arrivedCount;
      item.placements = counted.placements.map((p) => ({ placementId: p.placementId, quantity: p.quantity }));
      item.problems = [];
      if (counted.brokenCount > 0n) {
        item.problems.push({
          type: WarehouseTransferProblemType.BROKEN,
          count: counted.brokenCount,
          total: price * counted.brokenCount,
          note: counted.brokenNote,
        });
      }
      if (missing > 0n) {
        item.problems.push({
          type: WarehouseTransferProblemType.MISSING,
          count: missing,
          total: price * missing,
          note: counted.missingNote,
        });
      }
    }

    r.warehouseAdditionalCost = req.warehouseAdditionalCost;
    r.warehouseAdditionalCostNote = req.warehouseAdditionalCostNote;
    r.inboundTransactionId = 9500n + r.id;
    r.acceptedByUserId = SELF_ID;
    r.acceptedAtUnix = now();
    move(r, S.ACCEPTED);

    return { transfer: toWire(r, true) };
  },
};
