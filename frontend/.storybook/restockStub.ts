// inventory_service's RestockRequestService as Storybook's stub.
//
// It plays the server's DECIDED rules (docs/business/inventory/restock_decision.md), because the screens must already
// honour them:
//   the-warehouse-signs-and-accepts-the-team-does-the-rest   Arrive / Accept are the warehouse's; Create, Update,
//                                                           MarkLost and Cancel are the raising team's. The wrong side
//                                                           reads NotFound.
//   a-restock-is-cancelled-only-while-ongoing               Cancel from ongoing only; a second cancel is refused.
//   lost-is-set-only-before-the-box-arrives                 MarkLost from ongoing only.
//   a-late-lost-box-is-signed-for-as-arrived                Arrive from ongoing or lost.
//   accept-locks-the-restock                                Accept from ongoing or arrived only.
//   the-lines-stay-editable-until-accepted                  Update: ongoing → anything; arrived → the lines' count,
//   lines-can-be-added-not-removed-while-arrived              total and note, new lines (with a note), none removed.
//   accept-refuses-more-than-the-line-says                  received > count is refused.
//   a-short-unit-at-the-door-is-missing                     missing = count − received, worked out.
//   the-problem-price-is-filled-by-the-system               a problem row's price = line total × n ÷ line count.
//   the-courier-is-paid-once-per-restock                    one charge, its note required when above 0.
//   the-couriers-charge-stays-out-of-total                  total = goods + shipping.
//   every-status-change-is-logged, edits-are-in-the-same-trail   every change appends a trail row.
//   a-product-appears-once-per-restock                      a product twice on one restock is refused.
//
// WRITEABLE: a restock raised in one step is on the list in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  RestockActorRole,
  RestockDateField,
  RestockProblemType,
  RestockRequestListDataType,
  RestockRequestService,
  RestockRequestStatus as S,
} from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { racks } from "./fixtures";
import { type LineFixture, type RestockFixture, restockFixtures } from "./restockFixtures";
import { SELF_ID } from "./userStub";

let rows: RestockFixture[] = [];

export function resetRestockStub() {
  rows = structuredClone(restockFixtures);
}

resetRestockStub();

const now = () => BigInt(Math.floor(Date.now() / 1000));

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

const notFound = () => new ConnectError("restock request not found", Code.NotFound);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

// Either side may READ a restock; a third team reads NotFound.
function visible(teamId: bigint, id: bigint): RestockFixture {
  const found = rows.find((r) => r.id === id && (r.requestingTeamId === teamId || r.warehouseId === teamId));
  if (!found) throw notFound();

  return found;
}

// Only the RAISING team writes — the warehouse's attempt reads NotFound, never "forbidden".
function raisedBy(teamId: bigint, id: bigint): RestockFixture {
  const found = rows.find((r) => r.id === id && r.requestingTeamId === teamId);
  if (!found) throw notFound();

  return found;
}

// Only the RECEIVING warehouse signs and accepts.
function comingTo(teamId: bigint, id: bigint): RestockFixture {
  const found = rows.find((r) => r.id === id && r.warehouseId === teamId);
  if (!found) throw notFound();

  return found;
}

function appendLog(r: RestockFixture, from: S, to: S, description: string) {
  const id = r.logs.reduce((max, l) => (l.id > max ? l.id : max), 0n) + 1n;

  r.logs.push({ id, fromStatus: from, toStatus: to, actorUserId: SELF_ID, description, atUnix: now() });
}

const goodOf = (l: LineFixture) => {
  const broken = l.problems.filter((p) => p.type === RestockProblemType.BROKEN).reduce((s, p) => s + p.count, 0n);

  return l.receivedCount - broken;
};

// The restock as the wire carries it — prices worked out, totals summed, the trail only when asked.
function toWire(r: RestockFixture, withLogs: boolean) {
  const items = r.items.map((l) => ({
    ...l,
    priceUnit: l.count > 0n ? l.total / l.count : 0n,
    problems: l.problems.map((p) => ({
      ...p,
      priceUnit: l.count > 0n ? l.total / l.count : 0n,
      total: l.count > 0n ? (l.total * p.count) / l.count : 0n,
    })),
  }));
  const subtotal = r.items.reduce((s, l) => s + l.total, 0n);

  return {
    ...r,
    items,
    subtotal,
    total: subtotal + r.shipmentCost,
    logs: withLogs ? r.logs : [],
  };
}

type LineIn = {
  productId: bigint;
  sku: string;
  name: string;
  count: bigint;
  total: bigint;
  supplierId: bigint;
  supplierChannelId: bigint;
  note: string;
};

function onceEach(items: LineIn[]) {
  const seen = new Set<string>();
  for (const it of items) {
    const key = it.productId.toString();
    if (seen.has(key)) throw invalid("a product appears once per restock");
    seen.add(key);
  }
}

function newLines(r: { id: bigint }, items: LineIn[], startAt: number): LineFixture[] {
  return items.map((it, i) => ({
    id: r.id * 10n + BigInt(startAt + i + 1),
    productId: it.productId,
    sku: it.sku,
    name: it.name,
    count: it.count,
    total: it.total,
    supplierId: it.supplierId,
    supplierChannelId: it.supplierChannelId,
    note: it.note,
    receivedCount: 0n,
    problems: [],
    placements: [],
  }));
}

const dateOf = (r: RestockFixture, field: RestockDateField): bigint => {
  switch (field) {
    case RestockDateField.ARRIVED:
      return r.arrivedAtUnix;
    case RestockDateField.ACCEPTED:
      return r.acceptedAtUnix;
    case RestockDateField.LOST:
      return r.lostAtUnix;
    case RestockDateField.CANCELLED:
      return r.cancelledAtUnix;
    default:
      return r.createdAtUnix;
  }
};

// One restock as the wire carries it, trail included — for a component story that takes a RestockRequest prop rather
// than fetching one. Read from the LIVE table, so a story sees what an earlier write in it changed.
export function restockWire(id: bigint) {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no restock ${id}`);

  return toWire(found, true);
}

const rupiah = (n: bigint) => `Rp ${n.toLocaleString("id-ID")}`;

export const restockRequestService: Partial<ServiceImpl<typeof RestockRequestService>> = {
  restockRequestCreate(req) {
    if (req.items.length === 0) throw invalid("items: at least one line is required");
    if (req.financeAccountId === 0n) throw invalid("finance_account_id: value is required");
    onceEach(req.items);

    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const r: RestockFixture = {
      id,
      requestingTeamId: req.teamId,
      warehouseId: req.warehouseId,
      status: S.ONGOING,
      createdAtUnix: now(),
      items: [],
      receipt: req.receipt,
      receiptFile: req.receiptFile,
      shipmentId: req.shipmentId,
      invoiceRefId: req.invoiceRefId,
      financeAccountId: req.financeAccountId,
      shipmentCost: req.shipmentCost,
      warehouseAdditionalCost: 0n,
      warehouseAdditionalCostNote: "",
      note: req.note,
      transactionId: 0n,
      createdByUserId: SELF_ID,
      arrivedByUserId: 0n,
      acceptedByUserId: 0n,
      lostByUserId: 0n,
      cancelledByUserId: 0n,
      arrivedAtUnix: 0n,
      acceptedAtUnix: 0n,
      lostAtUnix: 0n,
      cancelledAtUnix: 0n,
      logs: [],
    };
    r.items = newLines(r, req.items, 0);
    appendLog(r, S.UNSPECIFIED, S.ONGOING, "created");
    rows.push(r);

    return { request: toWire(r, true) };
  },

  restockRequestList(req) {
    const f = req.filter;
    const q = (f?.q ?? "").trim().toLowerCase();
    const idQuery = q.replace(/^#/, "");
    const field = f?.dateField ?? RestockDateField.UNSPECIFIED;

    const matched = rows
      .filter((r) => r.requestingTeamId === req.teamId || r.warehouseId === req.teamId)
      .filter((r) => !f?.status || r.status === f.status)
      .filter((r) => !f?.productId || r.items.some((l) => l.productId === f.productId))
      .filter((r) => !f?.warehouseId || r.warehouseId === f.warehouseId)
      .filter((r) => !f?.requestingTeamId || r.requestingTeamId === f.requestingTeamId)
      .filter((r) => !f?.createdByUserId || r.createdByUserId === f.createdByUserId)
      .filter((r) => !f?.acceptedByUserId || r.acceptedByUserId === f.acceptedByUserId)
      .filter((r) => {
        if (!f?.fromUnix && !f?.toUnix) return true;
        const at = dateOf(r, field);
        if (at === 0n) return false;
        return (!f.fromUnix || at >= f.fromUnix) && (!f.toUnix || at <= f.toUnix);
      })
      .filter(
        (r) =>
          !q ||
          r.id.toString() === idQuery ||
          r.receipt.toLowerCase().includes(q) ||
          r.invoiceRefId.toLowerCase().includes(q) ||
          r.items.some((l) => l.sku.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.id > b.id ? -1 : 1));

    const { rows: page, pageInfo } = pageOf(matched, req.page);
    const mapData: Record<string, ReturnType<typeof toWire>> = {};
    for (const r of page) mapData[r.id.toString()] = toWire(r, false);

    const wantsRows =
      req.dataRequest.length === 0 || req.dataRequest.includes(RestockRequestListDataType.RESTOCK_REQUEST);

    return {
      items: wantsRows ? [{ d: { case: "restockRequest" as const, value: { mapData } } }] : [],
      ids: page.map((r) => r.id),
      pageInfo,
    };
  },

  restockActorList(req) {
    const role = req.filter?.role ?? RestockActorRole.UNSPECIFIED;
    const last = new Map<string, bigint>();

    for (const r of rows) {
      if (r.requestingTeamId !== req.teamId && r.warehouseId !== req.teamId) continue;
      const [who, at] =
        role === RestockActorRole.ACCEPTED ? [r.acceptedByUserId, r.acceptedAtUnix] : [r.createdByUserId, r.createdAtUnix];
      if (who === 0n) continue;
      const key = who.toString();
      if (!last.has(key) || (last.get(key) ?? 0n) < at) last.set(key, at);
    }

    const ids = [...last.entries()].sort((a, b) => (a[1] > b[1] ? -1 : 1)).map(([id]) => BigInt(id));
    const { rows: page, pageInfo } = pageOf(ids, req.page);
    const mapData: Record<string, { userId: bigint; lastAtUnix: bigint }> = {};
    for (const id of page) mapData[id.toString()] = { userId: id, lastAtUnix: last.get(id.toString()) ?? 0n };

    return { items: [{ d: { case: "actor" as const, value: { mapData } } }], ids: page, pageInfo };
  },

  restockRequestDetail(req) {
    return { request: toWire(visible(req.teamId, req.requestId), true) };
  },

  restockRequestUpdate(req) {
    const r = raisedBy(req.teamId, req.requestId);
    onceEach(req.items);

    if (r.status === S.ONGOING) {
      r.warehouseId = req.warehouseId;
      r.receipt = req.receipt;
      r.receiptFile = req.receiptFile;
      r.shipmentId = req.shipmentId;
      r.invoiceRefId = req.invoiceRefId;
      r.financeAccountId = req.financeAccountId;
      r.shipmentCost = req.shipmentCost;
      r.note = req.note;
      r.items = newLines(r, req.items, r.items.length + 10);
      appendLog(r, S.ONGOING, S.ONGOING, "edited");

      return { request: toWire(r, true) };
    }

    if (r.status !== S.ARRIVED) throw precondition("restock request is not ongoing");

    // ARRIVED: the parcel and its payment are closed; only the lines move.
    const headerChanged =
      req.warehouseId !== r.warehouseId ||
      req.receipt !== r.receipt ||
      req.receiptFile !== r.receiptFile ||
      req.shipmentId !== r.shipmentId ||
      req.invoiceRefId !== r.invoiceRefId ||
      req.financeAccountId !== r.financeAccountId ||
      req.shipmentCost !== r.shipmentCost ||
      req.note !== r.note;
    if (headerChanged) throw precondition("only the lines can change once the box has arrived");

    const changes: string[] = [];
    const next: LineFixture[] = [];

    for (const existing of r.items) {
      const incoming = req.items.find((it) => it.productId === existing.productId);
      if (!incoming) throw precondition("a line cannot be removed once the box has arrived — it is written as missing");
      if (incoming.supplierId !== existing.supplierId || incoming.supplierChannelId !== existing.supplierChannelId) {
        throw precondition("a line's store cannot change once the box has arrived");
      }
      if (incoming.count !== existing.count) {
        changes.push(`${existing.name} ${existing.count} → ${incoming.count}${incoming.note ? `, ${incoming.note}` : ""}`);
      }
      next.push({ ...existing, count: incoming.count, total: incoming.total, note: incoming.note });
    }

    const added = req.items.filter((it) => !r.items.some((l) => l.productId === it.productId));
    for (const it of added) {
      if (it.note.trim() === "") throw invalid("a line added after the box arrived needs a note");
      changes.push(`added ${it.name} × ${it.count}, ${it.note}`);
    }

    r.items = [...next, ...newLines(r, added, r.items.length + 20)];
    appendLog(r, S.ARRIVED, S.ARRIVED, changes.length > 0 ? changes.join("; ") : "edited");

    return { request: toWire(r, true) };
  },

  restockRequestArrive(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ONGOING && r.status !== S.LOST) throw precondition("only an ongoing or lost restock can be signed for");

    const from = r.status;
    r.status = S.ARRIVED;
    r.arrivedByUserId = SELF_ID;
    r.arrivedAtUnix = now();
    appendLog(r, from, S.ARRIVED, from === S.LOST ? "signed for the box — it turned up after all" : "signed for the box");

    return { request: toWire(r, true) };
  },

  restockRequestAccept(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ONGOING && r.status !== S.ARRIVED) {
      throw precondition("restock request can only be accepted while ongoing or arrived");
    }
    if (req.warehouseAdditionalCost > 0n && req.warehouseAdditionalCostNote.trim() === "") {
      throw invalid("the courier's charge needs a note");
    }

    const counted = new Map(req.lines.map((l) => [l.itemId.toString(), l]));
    if (counted.size !== req.lines.length || counted.size !== r.items.length) {
      throw invalid("every line of the request must be counted exactly once");
    }

    for (const l of r.items) {
      const c = counted.get(l.id.toString());
      if (!c) throw invalid("every line of the request must be counted exactly once");
      if (c.receivedCount > l.count) throw invalid("more arrived than ordered — ask the selling team to add them");
      if (c.brokenCount > c.receivedCount) throw invalid("broken cannot be more than received");

      const good = c.receivedCount - c.brokenCount;
      const placed = c.placements.reduce((s, p) => s + p.quantity, 0n);
      if (good > 0n && c.placements.length === 0) throw invalid("a line with good units must say which placement they went to");
      if (placed !== good) throw invalid("the placements must add up to the good units");
      for (const p of c.placements) {
        if (!racks.some((rack) => rack.id === p.placementId && rack.warehouseId === r.warehouseId)) {
          throw new ConnectError("rack not found", Code.NotFound);
        }
      }
    }

    let broken = 0n;
    let missing = 0n;

    for (const l of r.items) {
      const c = counted.get(l.id.toString())!;
      l.receivedCount = c.receivedCount;
      l.placements = c.placements.map((p) => ({ placementId: p.placementId, quantity: p.quantity }));
      l.problems = [];
      if (c.brokenCount > 0n) {
        l.problems.push({ type: RestockProblemType.BROKEN, count: c.brokenCount, note: c.brokenNote });
        broken += c.brokenCount;
      }
      const short = l.count - c.receivedCount;
      if (short > 0n) {
        l.problems.push({ type: RestockProblemType.MISSING, count: short, note: c.missingNote });
        missing += short;
      }
    }

    const from = r.status;
    r.status = S.ACCEPTED;
    r.acceptedByUserId = SELF_ID;
    r.acceptedAtUnix = now();
    if (r.arrivedAtUnix === 0n) {
      r.arrivedAtUnix = r.acceptedAtUnix;
      r.arrivedByUserId = SELF_ID;
    }
    r.warehouseAdditionalCost = req.warehouseAdditionalCost;
    r.warehouseAdditionalCostNote = req.warehouseAdditionalCostNote;
    r.transactionId = 9000n + r.id;

    const parts = [`${broken} broken, ${missing} missing`];
    if (req.warehouseAdditionalCost > 0n) parts.push(`courier's charge ${rupiah(req.warehouseAdditionalCost)}`);
    appendLog(r, from, S.ACCEPTED, `accepted — ${parts.join("; ")}`);

    return { request: toWire(r, true) };
  },

  restockRequestMarkLost(req) {
    const r = raisedBy(req.teamId, req.requestId);
    if (r.status !== S.ONGOING) throw precondition("only an ongoing restock can be marked lost");

    r.status = S.LOST;
    r.lostByUserId = SELF_ID;
    r.lostAtUnix = now();
    appendLog(r, S.ONGOING, S.LOST, req.description || "marked lost");

    return { request: toWire(r, true) };
  },

  restockRequestCancel(req) {
    const r = raisedBy(req.teamId, req.requestId);
    if (r.status !== S.ONGOING) throw precondition("restock request is not ongoing");

    r.status = S.CANCELLED;
    r.cancelledByUserId = SELF_ID;
    r.cancelledAtUnix = now();
    appendLog(r, S.ONGOING, S.CANCELLED, req.moneyReturned ? "cancelled — money returned" : "cancelled — money not returned");

    return { request: toWire(r, true) };
  },

  restockRequestLabels(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ACCEPTED) throw precondition("restock request is not accepted");

    const good = r.items.reduce((s, l) => s + goodOf(l), 0n);
    const perUnit = good > 0n ? (r.shipmentCost + r.warehouseAdditionalCost) / good : 0n;

    const labels = r.items.flatMap((l) => {
      const lineGood = goodOf(l);
      const hpp = lineGood > 0n ? l.total / lineGood + perUnit : 0n;

      return l.placements.map((p) => ({
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        batchId: l.id,
        quantity: p.quantity,
        placementCode: racks.find((rack) => rack.id === p.placementId)?.code ?? "",
        hpp,
      }));
    });
    const excluded = r.items.reduce((s, l) => s + l.problems.reduce((t, p) => t + p.count, 0n), 0n);

    return { restockId: r.id, receivedAtUnix: r.acceptedAtUnix, labels, excludedCount: excluded };
  },

  restockInboundStat(req) {
    const waiting = rows.filter(
      (r) =>
        r.warehouseId === req.teamId &&
        (r.status === S.ONGOING || r.status === S.ARRIVED) &&
        (!req.filter?.requestingTeamId || r.requestingTeamId === req.filter.requestingTeamId),
    );
    const lines = waiting.flatMap((r) => r.items);

    return {
      preview: {
        restockCount: BigInt(waiting.length),
        productCount: BigInt(new Set(lines.map((l) => l.productId.toString())).size),
        unitCount: lines.reduce((s, l) => s + l.count, 0n),
        amount: lines.reduce((s, l) => s + l.total, 0n),
        oldestPendingUnix: waiting.reduce((min, r) => (min === 0n || r.createdAtUnix < min ? r.createdAtUnix : min), 0n),
      },
    };
  },
};
