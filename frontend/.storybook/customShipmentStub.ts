// inventory_service's CustomShipmentService as Storybook's stub (backlog #88). The server is built
// (backend/services/inventory_service/inventory_v1/custom_shipment_*.go); the stub plays the same rules through the REAL
// proto shapes, so the five screens run their real queries, adapter and states. The prototype's in-memory server
// (the accepted design's play: a sample's take oldest batch first from the system's racks, a cancel putting it back, a
// reship's units reserved against the restock line, the cost edit's own trail row) lives on here.
//
// The rules it keeps (docs/business/custom_shipments/context_decision.md, docs/services/inventory_service/rpc.md):
//   the-selling-team-asks-the-warehouse-ships        Create / CostSet / Cancel / ReshipOptions are the owning selling
//                                                    team's; Picked / Handover the shipping warehouse's. The wrong side,
//                                                    and any other team, reads NotFound. The root team reads every one.
//   a-warehouse-sees-no-seller-money                 a warehouse reader is answered NO `total`, no line `total`, no
//                                                    `finance_account_id`, no TEAM payer's `shipping_cost` (unset, not
//                                                    0); a WAREHOUSE payer's cost is its own. A cost edit's trail row
//                                                    reaches it with its description empty.
//   the-courier-is-paid-by-the-team-or-by-the-warehouse  *Kami bayar* names one of the team's ACTIVE accounts (any,
//                                                    operational or not — activeAccountRefusal); *Gudang bayar* names
//                                                    neither and types its cost at the handover (required, 0 allowed),
//                                                    refused when the team pays.
//   a-custom-shipment-is-cancelled-only-while-requested  Cancel from requested only; a sample's units go back on the
//                                                    racks they left; a reship's units are free again.
//   the-custom-shipments-prototype-is-accepted       a sample takes at create (too few → FailedPrecondition, nothing
//                                                    written); a reship sends at most broken − already sent, one
//                                                    supplier per parcel; the idempotency key is unique per team.
//   missing-goods-leave-a-note-on-the-custom-shipment  (P6) MissingReport is the shipping warehouse's, only while
//                                                    requested: one GOODS_MISSING trail row with its lines, nothing
//                                                    else — a sample's line on a rack its take drew (at most what it
//                                                    drew there), a reship's on none; `goods_missing` is the latest
//                                                    while requested, on list rows too (both sides, no money).
//   missing-reship-units-are-not-offered-again       a cancelled reship's noted units are `not_found` — off the choices
//                                                    and the create's cap (the most any one note named of a line).
//
// WRITEABLE: a parcel made in one step is on the list in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  CustomShipmentDirection as D,
  CustomShipmentKind as K,
  CustomShipmentLogKind as LK,
  CustomShipmentPayer as P,
  CustomShipmentService,
  CustomShipmentStatus as S,
} from "../src/gen/warehouse/inventory/v1/custom_shipment_pb";
import type { StockPickLocationsRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";
import { products, teams } from "./fixtures";
import { activeAccountRefusal } from "./financialAccountStub";
import { SELF_ID } from "./userStub";
import {
  type ParcelLogRow,
  type ParcelMissingRow,
  type ParcelPickRow,
  type ParcelRow,
  type ReshipRestockRow,
  UNIT_VALUE,
  customShipmentRows,
  parcelShelves,
  parcelTransactionOf,
  reshipRestockRows,
} from "./customShipmentFixtures";
import { customShipmentScenario, resetCustomShipmentScenario } from "./customShipmentScenario";
import {
  arriveInbound,
  inboundById,
  inboundForList,
  inboundSideOf,
  inboundWire,
  markInboundLost,
  receiveInbound,
  recordResolutionCall,
  recordReturnWithParcel,
  returnRowOf,
  setInboundPrices,
  setInboundResi,
} from "./restockResolutionScenario";
import { putProblemTags } from "./restockTagScenario";

let rows: ParcelRow[] = [];
let restocks: ReshipRestockRow[] = [];
let shelves: Record<string, ParcelPickRow[]> = {};
let nextLog = 9000n;

export function resetCustomShipmentStub() {
  rows = customShipmentRows();
  restocks = reshipRestockRows();
  shelves = parcelShelves();
  nextLog = 9000n;
  resetCustomShipmentScenario();
}

resetCustomShipmentStub();

const ROOT_TEAM = 1n;
const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

const notFound = () => new ConnectError("custom shipment not found", Code.NotFound);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

const typeOf = (teamId: bigint) => teams.find((t) => t.id === teamId)?.type;

function record(rpc: string, req: object) {
  customShipmentScenario.calls.push({ rpc, req: { ...(req as Record<string, unknown>) } });
  const refuse = customShipmentScenario.refuseNext;
  if (refuse && refuse.rpc === rpc) {
    customShipmentScenario.refuseNext = null;
    throw precondition(refuse.message);
  }
}

/** Which side of a parcel the team reads it from — the server's `(team_id = X OR warehouse_id = X)`, root every one. */
function sideOf(row: ParcelRow, teamId: bigint): "owner" | "warehouse" | "root" | null {
  if (teamId === ROOT_TEAM) return "root";
  if (row.teamId === teamId) return "owner";
  if (row.warehouseId === teamId) return "warehouse";
  return null;
}

/** The OPEN goods-missing note — the latest GOODS_MISSING row while the parcel is requested, on list rows too. */
function openNote(row: ParcelRow) {
  if (row.status !== S.REQUESTED) return undefined;
  const note = row.logs.filter((l) => l.kind === LK.GOODS_MISSING).at(-1);

  return note
    ? {
        logId: note.id,
        lines: note.missing.map((line) => ({ ...line })),
        note: note.description,
        actorUserId: note.actorUserId,
        atUnix: note.atUnix,
        isOverride: note.isOverride,
      }
    : undefined;
}

/** The parcel as THIS reader receives it — customShipmentToProto's money rule (a-warehouse-sees-no-seller-money). */
function answer(rpc: string, row: ParcelRow, teamId: bigint, withLogs: boolean) {
  const moneyFree = sideOf(row, teamId) === "warehouse";
  const out = {
    id: row.id,
    teamId: row.teamId,
    warehouseId: row.warehouseId,
    kind: row.kind,
    status: row.status,
    restockId: row.restockId,
    supplierId: row.supplierId,
    recipient: { ...row.recipient },
    shipmentChannelId: row.shipmentChannelId,
    payer: row.payer,
    financeAccountId: moneyFree ? 0n : row.financeAccountId,
    shippingCost: moneyFree && row.payer === P.TEAM ? undefined : row.shippingCost,
    resi: row.resi,
    note: row.note,
    items: row.items.map((item) => ({ ...item, total: moneyFree ? undefined : item.total })),
    transactionId: row.transactionId,
    total: moneyFree ? undefined : row.total,
    // Backlog #101 — an outbound parcel; a reship that is a restock's RETURN names its row.
    direction: D.OUTBOUND,
    resolutionId: returnRowOf(row.id),
    logs: withLogs
      ? row.logs.map((log) => ({
          ...log,
          missing: log.missing.map((line) => ({ ...line })),
          // A cost edit's amounts are the team's money: the warehouse reads THAT it was edited, not what to. A
          // goods-missing note is from = to too, but it is the warehouse's own words — never blanked.
          description: moneyFree && log.fromStatus === log.toStatus && log.kind !== LK.GOODS_MISSING ? "" : log.description,
        }))
      : [],
    goodsMissing: openNote(row),
    createdByUserId: row.createdByUserId,
    createdAtUnix: row.createdAtUnix,
    pickedByUserId: row.pickedByUserId,
    pickedAtUnix: row.pickedAtUnix,
    handedOverByUserId: row.handedOverByUserId,
    handedOverAtUnix: row.handedOverAtUnix,
    cancelledByUserId: row.cancelledByUserId,
    cancelledAtUnix: row.cancelledAtUnix,
  };
  customShipmentScenario.answered.push({ rpc, teamId, shipment: out });

  return out;
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

function log(row: ParcelRow, from: S, to: S, description = "") {
  nextLog += 1n;
  row.logs.push({
    id: nextLog,
    kind: from === to ? LK.COST_EDIT : LK.STATUS,
    fromStatus: from,
    toStatus: to,
    actorUserId: SELF_ID,
    atUnix: nowUnix(),
    isOverride: false,
    description,
    missing: [],
  });
}

/** Units of a restock line that a reship that is not cancelled already carries — the server's `reshipItemLive`. */
function alreadySent(restockItemId: bigint): bigint {
  return rows
    .filter((r) => r.kind === K.RESTOCK_RESHIP && r.status !== S.CANCELLED)
    .flatMap((r) => r.items)
    .filter((i) => i.restockItemId === restockItemId)
    .reduce((sum, i) => sum + i.quantity, 0n);
}

/**
 * Units of a restock line a goods-missing note named on a CANCELLED reship — gone, never offered again (the server's
 * `reshipItemGone`): per reship line, the most any one note on it named.
 */
function goneOf(restockItemId: bigint): bigint {
  let gone = 0n;

  for (const r of rows.filter((x) => x.kind === K.RESTOCK_RESHIP && x.status === S.CANCELLED)) {
    for (const item of r.items.filter((i) => i.restockItemId === restockItemId)) {
      let most = 0n;
      for (const note of r.logs.filter((l) => l.kind === LK.GOODS_MISSING)) {
        const named = note.missing.filter((m) => m.itemId === item.id).reduce((sum, m) => sum + m.quantity, 0n);
        if (named > most) most = named;
      }
      gone += most;
    }
  }

  return gone;
}

/** Every unit of a restock line no reship may send — on a live reship, or noted gone on a cancelled one. */
const held = (restockItemId: bigint) => alreadySent(restockItemId) + goneOf(restockItemId);

/** A note's lines read as the server reads them back: the parcel line's product, the take's rack code. */
function missingRows(row: ParcelRow, lines: { itemId: bigint; rackId: bigint; quantity: bigint; rackCode?: string }[]): ParcelMissingRow[] {
  return lines.map((line) => {
    const item = row.items.find((i) => i.id === line.itemId)!;
    const rackCode = line.rackId > 0n ? (row.picks.find((p) => p.rackId === line.rackId)?.rackCode ?? line.rackCode ?? "") : "";

    return { itemId: item.id, productId: item.productId, productCode: item.productCode, name: item.name, rackId: line.rackId, rackCode, quantity: line.quantity };
  });
}

/**
 * A STORY'S SEED: a goods-missing note the server already holds — written while the parcel was requested (the shipping
 * warehouse's), placed in the trail by its time (none given: a minute after the parcel was asked for). It skips the
 * act's checks, so a parcel that has since been picked or cancelled can carry the note it was given before. Returns the
 * note's trail row id (its `custom-shipment-timeline-missing-<id>`).
 */
export function goodsMissingForStory(
  shipmentId: bigint,
  seed: {
    lines: { itemId: bigint; rackId: bigint; quantity: bigint; rackCode?: string }[];
    note: string;
    actorUserId: bigint;
    atUnix?: bigint;
  },
): bigint {
  const row = rows.find((r) => r.id === shipmentId)!;
  const atUnix = seed.atUnix ?? row.logs[0]!.atUnix + 1n;
  nextLog += 1n;
  const note: ParcelLogRow = {
    id: nextLog,
    kind: LK.GOODS_MISSING,
    fromStatus: S.REQUESTED,
    toStatus: S.REQUESTED,
    actorUserId: seed.actorUserId,
    atUnix,
    isOverride: false,
    description: seed.note,
    missing: missingRows(row, seed.lines),
  };
  const at = row.logs.findIndex((l) => l.atUnix > atUnix);
  row.logs.splice(at < 0 ? row.logs.length : at, 0, note);

  return note.id;
}

const rupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

/** A row the team holds as `side`, locked — anything else is NotFound, as `lockCustomShipment`. */
function mine(id: bigint, teamId: bigint, side: "owner" | "warehouse"): ParcelRow {
  const row = rows.find((r) => r.id === id);
  if (!row || (side === "owner" ? row.teamId !== teamId : row.warehouseId !== teamId)) throw notFound();

  return row;
}

export const customShipmentService: Partial<ServiceImpl<typeof CustomShipmentService>> = {
  customShipmentList(req) {
    record("CustomShipmentList", req);
    const f = req.filter;
    const needle = (f?.q ?? "").trim().toLowerCase().replace(/^#/, "");

    // The direction (#101): unasked, the selling team and root read both ways, a warehouse what it ships; INBOUND asks
    // for the parcels coming in (restockResolutionScenario.ts), OUTBOUND leaves them out.
    const inbound = inboundForList(req.teamId, typeOf(req.teamId) === TeamType.WAREHOUSE, f).map((p) => ({ id: p.id, inbound: p }));
    const outbound = rows
      .filter(() => f?.direction !== D.INBOUND)
      .filter((r) => sideOf(r, req.teamId) !== null)
      .filter((r) => !f?.status || r.status === f.status)
      .filter((r) => !f?.kind || r.kind === f.kind)
      .filter((r) => !f?.warehouseId || r.warehouseId === f.warehouseId)
      .filter(
        (r) =>
          needle === "" ||
          r.id.toString() === needle ||
          r.recipient.name.toLowerCase().includes(needle) ||
          r.items.some((i) => i.productCode.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle)),
      )
      .map((r) => ({ id: r.id, outbound: r }));
    const matched = [...inbound, ...outbound].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const { rows: window, pageInfo } = pageOf(matched, req.page);

    return {
      customShipments: window.map((m) => ("inbound" in m ? inboundWire(m.inbound, req.teamId) : answer("CustomShipmentList", m.outbound, req.teamId, false))),
      pageInfo,
    };
  },

  customShipmentDetail(req) {
    record("CustomShipmentDetail", req);
    const row = rows.find((r) => r.id === req.id);
    // An inbound parcel (#101), as either side reads it.
    const coming = inboundById(req.id);
    if (!row && coming && inboundSideOf(coming, req.teamId) !== null) return { customShipment: inboundWire(coming, req.teamId) };
    if (!row || sideOf(row, req.teamId) === null) throw notFound();

    return { customShipment: answer("CustomShipmentDetail", row, req.teamId, true) };
  },

  // ── THE INBOUND PARCEL'S MOVES (backlog #101) — restockResolutionScenario.ts plays the rules. ──
  customShipmentResiSet(req) {
    recordResolutionCall("CustomShipmentResiSet", req);
    return { customShipment: inboundWire(setInboundResi(req), req.teamId) };
  },

  customShipmentPricesSet(req) {
    recordResolutionCall("CustomShipmentPricesSet", req);
    return { customShipment: inboundWire(setInboundPrices(req), req.teamId) };
  },

  customShipmentMarkLost(req) {
    recordResolutionCall("CustomShipmentMarkLost", req);
    return { customShipment: inboundWire(markInboundLost(req), req.teamId) };
  },

  customShipmentArrive(req) {
    recordResolutionCall("CustomShipmentArrive", req);
    return { customShipment: inboundWire(arriveInbound(req), req.teamId) };
  },

  customShipmentReceive(req) {
    recordResolutionCall("CustomShipmentReceive", req);
    const { parcel, short, broken } = receiveInbound(req);
    // A short or broken count puts a received restock's problem tags back on (a lost one carries none).
    if ((short || broken) && !parcel.restockLost) putProblemTags(parcel.restockId, short, broken);

    return { customShipment: inboundWire(parcel, req.teamId) };
  },

  customShipmentReshipOptions(req) {
    record("CustomShipmentReshipOptions", req);
    const needle = req.q.trim().toLowerCase();

    const offered = restocks
      .filter((r) => r.teamId === req.teamId)
      .map((r) => ({
        restockId: r.restockId,
        teamId: r.teamId,
        warehouseId: r.warehouseId,
        acceptedAtUnix: r.acceptedAtUnix,
        lines: r.lines
          .map((line) => ({ ...line, alreadySent: alreadySent(line.restockItemId), notFound: goneOf(line.restockItemId) }))
          .filter((line) => line.broken > line.alreadySent + line.notFound),
      }))
      .filter((r) => r.lines.length > 0)
      .filter(
        (r) =>
          needle === "" ||
          r.restockId.toString() === needle.replace(/^#/, "") ||
          r.lines.some((l) => l.productCode.toLowerCase().includes(needle) || l.name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => (a.acceptedAtUnix < b.acceptedAtUnix ? 1 : a.acceptedAtUnix > b.acceptedAtUnix ? -1 : 0));
    const { rows: window, pageInfo } = pageOf(offered, req.page);

    return { options: window, pageInfo };
  },

  customShipmentCreate(req) {
    record("CustomShipmentCreate", req);
    if (typeOf(req.teamId) !== TeamType.SELLING) throw new ConnectError("only a selling team creates a custom shipment", Code.PermissionDenied);
    if (!req.recipient?.name || !req.recipient.phone || !req.recipient.address) throw invalid("recipient: name, phone and address are required");
    if (req.lines.length === 0) throw invalid("lines: at least one");
    if (req.shipmentChannelId === 0n) throw invalid("shipment_channel_id: required");
    if (req.idempotencyKey === "") throw invalid("idempotency_key: required");
    // A restock's RETURN (#101) rides a reship only.
    if (req.resolution && req.kind !== K.RESTOCK_RESHIP) throw invalid("only a reship is a restock's return");
    if (rows.some((r) => r.teamId === req.teamId && r.idempotencyKey === req.idempotencyKey)) {
      throw new ConnectError("this create was already sent", Code.AlreadyExists);
    }

    // WHO PAYS — the team names an active account of its own; the warehouse names neither.
    if (req.payer === P.TEAM) {
      if (req.financeAccountId === 0n) throw invalid("finance_account_id: the team pays from one of its accounts");
      const refused = activeAccountRefusal(req.teamId, req.financeAccountId);
      if (refused) throw precondition(refused);
    } else if (req.financeAccountId !== 0n || req.shippingCost !== 0) {
      throw invalid("the warehouse pays: no account and no cost now — it types the cost at the handover");
    }

    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const base = {
      id,
      teamId: req.teamId,
      status: S.REQUESTED,
      recipient: { ...req.recipient },
      shipmentChannelId: req.shipmentChannelId,
      payer: req.payer,
      financeAccountId: req.payer === P.TEAM ? req.financeAccountId : 0n,
      shippingCost: req.payer === P.TEAM ? req.shippingCost : 0,
      resi: "",
      note: req.note,
      logs: [],
      createdByUserId: SELF_ID,
      createdAtUnix: nowUnix(),
      pickedByUserId: 0n,
      pickedAtUnix: 0n,
      handedOverByUserId: 0n,
      handedOverAtUnix: 0n,
      cancelledByUserId: 0n,
      cancelledAtUnix: 0n,
      idempotencyKey: req.idempotencyKey,
    };
    let row: ParcelRow;

    if (req.kind === K.SAMPLE) {
      if (req.warehouseId === 0n) throw invalid("warehouse_id: a sample names the warehouse its units leave");
      const own = (productId: bigint) => products.find((p) => p.id === productId && p.teamId === req.teamId);
      for (const line of req.lines) if (!own(line.productId)) throw invalid(`product #${line.productId} is not the team's own`);

      // TOO FEW FAILS THE WHOLE CREATE — every short line named, nothing taken.
      const short = req.lines.filter((line) => {
        const held = (shelves[`${req.warehouseId}:${line.productId}`] ?? []).reduce((sum, s) => sum + s.quantity, 0n);
        return held < line.quantity;
      });
      if (short.length > 0) throw precondition(`not enough stock: ${short.map((l) => own(l.productId)!.productCode).join(", ")}`);

      // THE TAKE, oldest batch first, the system picking the racks (a-sample-names-the-rack-it-was-taken-from's principle row).
      const picks: ParcelPickRow[] = [];
      for (const line of req.lines) {
        let wanted = line.quantity;
        for (const shelf of shelves[`${req.warehouseId}:${line.productId}`] ?? []) {
          if (wanted === 0n) break;
          const take = shelf.quantity < wanted ? shelf.quantity : wanted;
          if (take === 0n) continue;
          shelf.quantity -= take;
          wanted -= take;
          picks.push({ productId: line.productId, rackId: shelf.rackId, rackCode: shelf.rackCode, quantity: take });
        }
      }
      const items = req.lines.map((line, i) => {
        const product = own(line.productId)!;
        return {
          id: id * 100n + BigInt(i + 1),
          productId: line.productId,
          productCode: product.productCode,
          name: product.name,
          quantity: line.quantity,
          total: Number(line.quantity) * (UNIT_VALUE[line.productId.toString()] ?? 0),
          restockItemId: 0n,
          brokenNote: "",
        };
      });

      row = {
        ...base,
        warehouseId: req.warehouseId,
        kind: K.SAMPLE,
        restockId: 0n,
        supplierId: 0n,
        items,
        transactionId: parcelTransactionOf(id),
        total: items.reduce((sum, i) => sum + i.total, 0),
        picks,
      };
    } else if (req.kind === K.RESTOCK_RESHIP) {
      const restock = restocks.find((r) => r.restockId === req.restockId && r.teamId === req.teamId);
      if (!restock) throw notFound();
      if (req.warehouseId !== 0n && req.warehouseId !== restock.warehouseId) throw invalid("warehouse_id: a reship ships from its restock's warehouse");

      const lines = req.lines.map((line) => {
        const found = restock.lines.find((l) => l.restockItemId === line.restockItemId);
        if (!found || (line.productId !== 0n && line.productId !== found.productId)) throw invalid(`restock line #${line.restockItemId} is not this restock's`);
        return { line, found };
      });
      if (new Set(lines.map((l) => l.found.supplierId.toString())).size > 1) throw invalid("one parcel goes to one supplier");
      const over = lines.filter(({ line, found }) => line.quantity > found.broken - held(found.restockItemId));
      if (over.length > 0) throw precondition(`more than the broken units left: ${over.map((o) => o.found.productCode).join(", ")}`);

      row = {
        ...base,
        warehouseId: restock.warehouseId,
        kind: K.RESTOCK_RESHIP,
        restockId: restock.restockId,
        supplierId: lines[0]!.found.supplierId,
        items: lines.map(({ line, found }, i) => ({
          id: id * 100n + BigInt(i + 1),
          productId: found.productId,
          productCode: found.productCode,
          name: found.name,
          quantity: line.quantity,
          total: 0,
          restockItemId: found.restockItemId,
          brokenNote: found.brokenNote,
        })),
        transactionId: 0n,
        total: 0,
        picks: [],
      };
    } else {
      throw invalid("kind: required");
    }

    log(row, S.UNSPECIFIED, S.REQUESTED);
    rows = [row, ...rows];
    // A RETURN (#101): the restock's resolution row — and its Riwayat row — recorded with this reship parcel.
    if (req.resolution) recordReturnWithParcel(row.restockId, req.resolution.note, row.id);

    return { customShipment: answer("CustomShipmentCreate", row, req.teamId, true) };
  },

  customShipmentCostSet(req) {
    record("CustomShipmentCostSet", req);
    const row = mine(req.id, req.teamId, "owner");
    if (row.payer !== P.TEAM) throw precondition("the warehouse pays this courier — the team has no cost to set");
    if (row.status !== S.REQUESTED && row.status !== S.PICKED) throw precondition("the cost is final once handed over");
    if (req.financeAccountId !== row.financeAccountId) {
      const refused = activeAccountRefusal(req.teamId, req.financeAccountId);
      if (refused) throw precondition(refused);
    }

    if (req.financeAccountId !== row.financeAccountId || req.shippingCost !== row.shippingCost) {
      const moved = `${rupiah(row.shippingCost)} → ${rupiah(req.shippingCost)}`;
      row.financeAccountId = req.financeAccountId;
      row.shippingCost = req.shippingCost;
      log(row, row.status, row.status, moved);
    }

    return { customShipment: answer("CustomShipmentCostSet", row, req.teamId, true) };
  },

  customShipmentCancel(req) {
    record("CustomShipmentCancel", req);
    const row = mine(req.id, req.teamId, "owner");
    if (row.status !== S.REQUESTED) throw precondition("only a requested parcel can be cancelled");

    // A SAMPLE'S UNITS GO BACK ON THE RACKS THEY LEFT; a reship's units drop out of the live-reships sum by the status.
    for (const pick of row.picks) {
      const shelf = (shelves[`${row.warehouseId}:${pick.productId}`] ?? []).find((s) => s.rackId === pick.rackId);
      if (shelf) shelf.quantity += pick.quantity;
    }
    log(row, row.status, S.CANCELLED);
    row.status = S.CANCELLED;
    row.cancelledByUserId = SELF_ID;
    row.cancelledAtUnix = nowUnix();

    return { customShipment: answer("CustomShipmentCancel", row, req.teamId, true) };
  },

  customShipmentPicked(req) {
    record("CustomShipmentPicked", req);
    const row = mine(req.id, req.teamId, "warehouse");
    if (row.status !== S.REQUESTED) throw precondition("only a requested parcel is picked");

    log(row, S.REQUESTED, S.PICKED);
    row.status = S.PICKED;
    row.pickedByUserId = SELF_ID;
    row.pickedAtUnix = nowUnix();

    return { customShipment: answer("CustomShipmentPicked", row, req.teamId, true) };
  },

  // *BARANG TIDAK KETEMU* (P6) — the server's judgeMissingLines: the shipping warehouse only (anyone else NotFound),
  // only while requested; each line this parcel's, a line and rack once; a sample's line on a rack its take drew (rack 0
  // only for a line the take recorded no rack for), at most what it drew there; a reship's on none, at most its units.
  // One GOODS_MISSING row and nothing else: no status, no stock.
  customShipmentMissingReport(req) {
    record("CustomShipmentMissingReport", req);
    const row = mine(req.id, req.teamId, "warehouse");
    if (row.status !== S.REQUESTED) throw precondition("a custom shipment is noted with goods missing only while requested");
    if (req.lines.length === 0) throw invalid("lines: at least one");
    if ([...req.note].length > 200) throw invalid("note: at most 200 characters");

    const seen = new Set<string>();
    for (const line of req.lines) {
      const item = row.items.find((i) => i.id === line.itemId);
      if (!item) throw invalid(`line ${line.itemId} is not this parcel's`);
      const key = `${line.itemId}:${line.rackId}`;
      if (seen.has(key)) throw invalid("a goods-missing note names a line and rack once");
      seen.add(key);

      let most = item.quantity;
      if (row.kind === K.RESTOCK_RESHIP) {
        if (line.rackId !== 0n) throw invalid("a reship's broken units were never on a rack — its lines name none");
      } else {
        const racks = row.picks.filter((p) => p.productId === item.productId);
        if (line.rackId === 0n) {
          if (racks.length > 0) throw invalid("a goods-missing line names a rack this line's take drew from");
        } else {
          const pick = racks.find((p) => p.rackId === line.rackId);
          if (!pick) throw invalid(`rack ${line.rackId} is not one this line's take drew from`);
          most = pick.quantity;
        }
      }
      if (line.quantity === 0n || line.quantity > most) throw invalid(`more missing than the parcel holds there (${most})`);
    }

    nextLog += 1n;
    row.logs.push({
      id: nextLog,
      kind: LK.GOODS_MISSING,
      fromStatus: S.REQUESTED,
      toStatus: S.REQUESTED,
      actorUserId: SELF_ID,
      atUnix: nowUnix(),
      isOverride: false,
      description: req.note.trim(),
      missing: missingRows(row, req.lines),
    });

    return { customShipment: answer("CustomShipmentMissingReport", row, req.teamId, true) };
  },

  customShipmentHandover(req) {
    record("CustomShipmentHandover", req);
    const row = mine(req.id, req.teamId, "warehouse");
    if (row.status !== S.PICKED) throw precondition("only a picked parcel is handed over");
    if (row.payer === P.WAREHOUSE && req.shippingCost === undefined) throw invalid("shipping_cost: the warehouse pays — type what the courier cost");
    if (row.payer === P.TEAM && req.shippingCost !== undefined) throw invalid("shipping_cost: the team pays this courier");

    if (row.payer === P.WAREHOUSE) row.shippingCost = req.shippingCost!;
    row.resi = req.resi.trim();
    log(row, S.PICKED, S.HANDED_OVER);
    row.status = S.HANDED_OVER;
    row.handedOverByUserId = SELF_ID;
    row.handedOverAtUnix = nowUnix();

    return { customShipment: answer("CustomShipmentHandover", row, req.teamId, true) };
  },
};

/**
 * StockPickLocations for a SAMPLE's take — the racks the create drew, in the asked warehouse only; `null` when the
 * transaction is no parcel's (stubTransport then answers it as an order's take).
 */
export function customShipmentPickLocations(req: StockPickLocationsRequest) {
  if (req.transactionId === 0n) return null;
  const row = rows.find((r) => r.transactionId === req.transactionId);
  if (!row) return null;

  return {
    locations:
      row.warehouseId === req.warehouseId
        ? row.picks.map((p) => ({ productId: p.productId, rackId: p.rackId, rackCode: p.rackCode, quantity: p.quantity, transactionId: req.transactionId }))
        : [],
  };
}
