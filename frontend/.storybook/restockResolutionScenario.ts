// THE RESTOCK RESOLUTIONS AND THE SUPPLIER'S RESHIPPING AS STORYBOOK'S SERVER (backlog #101) — what the stub transport
// answers for the phase-1 RPCs, wired into restockStub.ts (RestockResolutionCreate, RestockRequestSettle, the restock's
// `resolutions` / `resolution_count` / settled mark / its Riwayat rows, the list's `settled` filter) and
// customShipmentStub.ts (the INBOUND parcels in CustomShipmentList / Detail; CustomShipmentResiSet / PricesSet / MarkLost /
// Arrive / Receive; CustomShipmentCreate's `resolution`). Imported by those stubs and by the stories' kit — never a stub by
// a story (CLAUDE.md, Storybook).
//
// EMPTY BY DEFAULT: no resolution, no settled restock, no inbound parcel — every story outside #101 reads today's restocks.
// A story seeds it (seedRestockResolutionsForStory) — the accepted prototype's seed, over restockFixtures.ts' restocks
// (Toko Melati 12 → Gudang Pusat 11, paid from BCA Operasional 1301):
//
//   503  Diterima — Beras 2 rusak · 1 kurang   a refund of Rp 65.000 (row 1), a reshipping (row 2 → #901, on its way:
//        2 Beras at Rp 65.000) — still open
//   504  Hilang — Gula 40                        a refund of Rp 400.000 (row 3), a reshipping (row 4 → #902, at the door:
//        15 Gula, Rp 8.000 charged by the courier) — still open
//   507  (secondProblemRestock: Teh 3 kurang)    a refund (row 5), SETTLED three days ago — its Barang kurang taken off
//
// The rules it plays, as the server (docs/services/inventory_service/rpc.md, *Restock resolutions and the inbound parcel*):
//   a-restock-problem-is-settled-by-resolution-rows   rows on a restock that takes them (received with problem counts, or
//       lost, settled or not); a lost one takes no RETURN; a refund names its amount and an account; a settle once, by the
//       owning selling team, takes the problem tags off; a SETTLED restock still takes rows and stays settled (🔄 A); an
//       inbound parcel's Terima with short or broken units REOPENS it — the mark lifted, the tags back on (🔄 A).
//   the Riwayat (the owner's 🔄 A)                     one trail row per resolution, per settle, per reopen — kept,
//       never rewritten, carried in the restock's `logs` by their time (RestockLog.kind; the changes name what they record).
//   a-warehouse-sees-no-seller-money                   a warehouse reader is answered no refund amount, no account and no
//       seller price (UNSET).
//   a-suppliers-reshipping-comes-in-as-a-custom-shipment  a reshipping creates its INBOUND parcel in the same step; the
//       seller sets its resi until Tiba, its prices until Terima, Hilang before it arrives; the warehouse signs (Tiba —
//       a lost one too) and counts it (Terima: received ≤ sent, broken ≤ received, good units on a rack).

import { Code, ConnectError } from "@connectrpc/connect";

import {
  CustomShipmentDirection as D,
  CustomShipmentKind as K,
  CustomShipmentPayer as P,
  CustomShipmentStatus as S,
} from "../src/gen/warehouse/inventory/v1/custom_shipment_pb";
import { RestockResolutionType as T, RestockSettledFilter } from "../src/gen/warehouse/inventory/v1/restock_resolution_pb";
import {
  RestockLogChangeField as CF,
  RestockLogKind,
  RestockRequestStatus as RS,
  RestockProblemType,
} from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { daysAgo, products } from "./fixtures";

const ANI = 61n; // Toko Melati's
const BUDI = 62n; // Gudang Pusat's

export interface ResolutionRow {
  id: bigint;
  restockId: bigint;
  type: T;
  note: string;
  refundAmount: number;
  financeAccountId: bigint;
  customShipmentId: bigint;
  inventoryTransactionId: bigint;
  createdByUserId: bigint;
  createdAtUnix: bigint;
}

export interface InboundLineRow {
  id: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  quantity: bigint;
  priceUnit: number;
  received?: bigint;
  broken?: bigint;
  rackId: bigint;
}

export interface InboundRow {
  id: bigint;
  teamId: bigint;
  warehouseId: bigint;
  restockId: bigint;
  resolutionId: bigint;
  status: S;
  supplierId: bigint;
  shipmentChannelId: bigint;
  resi: string;
  items: InboundLineRow[];
  shippingCost: number;
  chargeNote: string;
  createdByUserId: bigint;
  createdAtUnix: bigint;
  arrivedByUserId: bigint;
  arrivedAtUnix: bigint;
  receivedByUserId: bigint;
  receivedAtUnix: bigint;
  lostByUserId: bigint;
  lostAtUnix: bigint;
  lostReason: string;
  /** Its restock is a LOST one — a reopen there lifts the mark alone (a lost restock carries no problem tag). */
  restockLost: boolean;
}

/** A Riwayat row of the settlement — RestockLog on the wire (kind RESOLUTION / SETTLED / REOPENED). */
export interface SettlementLogRow {
  id: bigint;
  restockId: bigint;
  kind: RestockLogKind;
  actorUserId: bigint;
  atUnix: bigint;
  description: string;
  changes: { field: CF; productId: bigint; productName: string; before: string; after: string }[];
}

export interface ResolutionCall {
  rpc: string;
  req: Record<string, unknown>;
}

export const restockResolutionScenario = {
  /** Every #101 write the screens sent, in order — the real proto request. */
  calls: [] as ResolutionCall[],
  /** Every RestockRequestList's status and `settled` filter, in order — what the Hilang tab asked. */
  listAsks: [] as { status: RS; settled: RestockSettledFilter }[],
  resolutions: [] as ResolutionRow[],
  settled: new Map<string, { userId: bigint; atUnix: bigint }>(),
  parcels: [] as InboundRow[],
  logs: [] as SettlementLogRow[],
  /** Who writes — the signed-in person (Ani, 61); a warehouse story names Budi (62). */
  actor: ANI,
  /** Set by a story: the next write of this RPC is refused with the server's sentence (FailedPrecondition). */
  refuseNext: null as null | { rpc: string; message: string },
  nextResolution: 100n,
  // Inbound parcels number from 9xx — the outbound fixtures are 8xx and a new outbound one takes the next of those.
  nextParcel: 950n,
  nextLine: 95000n,
  nextLog: 9100n,
};

export function resetRestockResolutionScenario() {
  const s = restockResolutionScenario;
  s.calls.length = 0;
  s.listAsks = [];
  s.resolutions = [];
  s.settled = new Map();
  s.parcels = [];
  s.logs = [];
  s.actor = ANI;
  s.refuseNext = null;
  s.nextResolution = 100n;
  s.nextParcel = 950n;
  s.nextLine = 95000n;
  s.nextLog = 9100n;
}

const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);
const notFound = () => new ConnectError("not found", Code.NotFound);
const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

/** Records a write; refuses it when a story asked (the server's sentence, nothing written). */
export function recordResolutionCall(rpc: string, req: object) {
  const s = restockResolutionScenario;
  s.calls.push({ rpc, req: { ...(req as Record<string, unknown>) } });
  if (s.refuseNext && s.refuseNext.rpc === rpc) {
    const message = s.refuseNext.message;
    s.refuseNext = null;
    throw precondition(message);
  }
}

/** The writes only (the reads every mount makes are left out). */
export const resolutionWrites = () => restockResolutionScenario.calls.map((c) => c.rpc);

// ── The seed ────────────────────────────────────────────────────────────────────────────────────────────────────────

function seedRow(id: bigint, restockId: bigint, type: T, note: string, ago: number, extra: Partial<ResolutionRow> = {}): ResolutionRow {
  return {
    id,
    restockId,
    type,
    note,
    refundAmount: 0,
    financeAccountId: 0n,
    customShipmentId: 0n,
    inventoryTransactionId: 0n,
    createdByUserId: ANI,
    createdAtUnix: daysAgo(ago),
    ...extra,
  };
}

function seedParcel(fields: Partial<InboundRow> & Pick<InboundRow, "id" | "restockId" | "resolutionId" | "status" | "items">): InboundRow {
  return {
    teamId: 12n,
    warehouseId: 11n,
    supplierId: 31n,
    shipmentChannelId: 91n,
    resi: "",
    shippingCost: 0,
    chargeNote: "",
    createdByUserId: ANI,
    createdAtUnix: daysAgo(1),
    arrivedByUserId: 0n,
    arrivedAtUnix: 0n,
    receivedByUserId: 0n,
    receivedAtUnix: 0n,
    lostByUserId: 0n,
    lostAtUnix: 0n,
    lostReason: "",
    restockLost: false,
    ...fields,
  };
}

/** The Riwayat row id the seed gives resolution row `id` (1–5), and the 507 settle's. */
export const SEED_LOG = { resolution: (id: bigint) => 9000n + id, settled507: 9006n } as const;

/** The restocks the seed holds as settled — their problem tags taken off (the story kit does it, as the settle did). */
export const SETTLED_IN_SEED = [507n];

/**
 * A STORY'S SEED — the accepted prototype's rows, parcels and settle (the header's table), each with its Riwayat row.
 * The caller takes 507's problem tags off (restockTagScenario.takeProblemTagsOff), as the settle did.
 */
export function seedRestockResolutionsForStory() {
  const s = restockResolutionScenario;
  s.resolutions = [
    seedRow(1n, 503n, T.REFUND, "Supplier transfer untuk 1 karung yang kurang", 2, { refundAmount: 65_000, financeAccountId: 1301n }),
    seedRow(2n, 503n, T.RESHIPPING, "Supplier kirim ulang 2 karung pengganti yang sobek", 1, { customShipmentId: 901n }),
    seedRow(3n, 504n, T.REFUND, "Klaim kurir disetujui untuk 25 pcs", 3, { refundAmount: 400_000, financeAccountId: 1301n }),
    seedRow(4n, 504n, T.RESHIPPING, "Sisa 15 pcs dikirim ulang supplier", 2, { customShipmentId: 902n }),
    seedRow(5n, 507n, T.REFUND, "3 pcs kurang dikembalikan supplier", 4, { refundAmount: 45_000, financeAccountId: 1303n }),
  ];
  s.settled = new Map([["507", { userId: ANI, atUnix: daysAgo(3) }]]);
  s.parcels = [
    seedParcel({
      id: 901n,
      restockId: 503n,
      resolutionId: 2n,
      status: S.ON_THE_WAY,
      resi: "JNE5566778899",
      items: [{ id: 90101n, productId: 74n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg", quantity: 2n, priceUnit: 65_000, rackId: 0n }],
    }),
    seedParcel({
      id: 902n,
      restockId: 504n,
      resolutionId: 4n,
      status: S.ARRIVED,
      supplierId: 32n,
      shipmentChannelId: 92n,
      resi: "JNT4455667788",
      createdAtUnix: daysAgo(2),
      arrivedByUserId: BUDI,
      arrivedAtUnix: daysAgo(0),
      shippingCost: 8_000,
      chargeNote: "Ongkir COD diminta kurir",
      restockLost: true,
      items: [{ id: 90201n, productId: 73n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg", quantity: 15n, priceUnit: 16_000, rackId: 0n }],
    }),
  ];
  s.logs = [
    ...s.resolutions.map((r) => resolutionLog(SEED_LOG.resolution(r.id), r)),
    { id: SEED_LOG.settled507, restockId: 507n, kind: RestockLogKind.SETTLED, actorUserId: ANI, atUnix: daysAgo(3), description: "settled", changes: [] },
  ];
}

function resolutionLog(id: bigint, r: ResolutionRow): SettlementLogRow {
  return {
    id,
    restockId: r.restockId,
    kind: RestockLogKind.RESOLUTION,
    actorUserId: r.createdByUserId,
    atUnix: r.createdAtUnix,
    description: "resolution recorded",
    changes: [{ field: CF.RESOLUTION, productId: 0n, productName: "", before: "", after: r.id.toString() }],
  };
}

function writeLog(row: Omit<SettlementLogRow, "id">) {
  const s = restockResolutionScenario;
  s.nextLog += 1n;
  s.logs.push({ id: s.nextLog, ...row });
}

// ── The restock's side (restockStub.ts) ─────────────────────────────────────────────────────────────────────────────

/** What restockStub needs of a restock — its fixture row's fields. */
export interface RestockFacts {
  id: bigint;
  requestingTeamId: bigint;
  warehouseId: bigint;
  status: RS;
  financeAccountId: bigint;
  items: { productId: bigint; supplierId: bigint; problems: { type: RestockProblemType; count: bigint }[] }[];
}

/** The restock's #101 fields as THIS reader receives them — the rows on the detail only, money for the owner only. */
export function resolutionFieldsOf(r: RestockFacts, withRows: boolean, reader?: bigint) {
  const s = restockResolutionScenario;
  const rows = s.resolutions.filter((x) => x.restockId === r.id);
  const money = reader === r.requestingTeamId;
  const mark = s.settled.get(r.id.toString());

  return {
    resolutions: withRows
      ? rows.map((x) => ({
          ...x,
          refundAmount: money && x.type === T.REFUND ? x.refundAmount : undefined,
          financeAccountId: money ? x.financeAccountId : 0n,
          createdByIsOverride: false,
        }))
      : [],
    resolutionCount: rows.length,
    settledAtUnix: mark?.atUnix ?? 0n,
    settledByUserId: mark?.userId ?? 0n,
    settledByIsOverride: false,
  };
}

/** The restock's settlement rows of the Riwayat, as RestockLog — merged into its `logs` by time. */
export function settlementLogsOf(restockId: bigint, status: RS) {
  return restockResolutionScenario.logs
    .filter((l) => l.restockId === restockId)
    .map((l) => ({
      id: l.id,
      fromStatus: status,
      toStatus: status,
      actorUserId: l.actorUserId,
      description: l.description,
      atUnix: l.atUnix,
      kind: l.kind,
      changes: l.changes.map((c) => ({ ...c })),
    }));
}

/** The list's `settled` filter — UNSPECIFIED either; SETTLED / UNSETTLED by the mark. */
export function settledMatches(restockId: bigint, filter: RestockSettledFilter | undefined): boolean {
  if (!filter) return true;
  const settled = restockResolutionScenario.settled.has(restockId.toString());

  return filter === RestockSettledFilter.SETTLED ? settled : !settled;
}

const hasProblem = (r: RestockFacts) => r.items.some((l) => l.problems.some((p) => p.count > 0n));

function takesResolutions(r: RestockFacts) {
  if (r.status === RS.LOST) return;
  if (r.status === RS.ACCEPTED && hasProblem(r)) return;
  throw precondition("only a received restock with a problem, or a lost one, takes a resolution");
}

/** The restock's broken units still to send back — a RETURN's eligibility (the server's: a problem restock, not a lost one). */
export function returnEligible(r: RestockFacts) {
  takesResolutions(r);
  if (r.status === RS.LOST) throw precondition("a lost restock takes no return — nothing came to send back");
}

export interface ResolutionCreateIn {
  teamId: bigint;
  restockId: bigint;
  type: T;
  note: string;
  refundAmount: number;
  financeAccountId: bigint;
  customShipmentId: bigint;
  reshipping?: {
    warehouseId: bigint;
    shipmentChannelId: bigint;
    resi: string;
    supplierId: bigint;
    lines: { productId: bigint; count: bigint; priceUnit: number }[];
  };
  idempotencyKey: string;
}

/** RestockResolutionCreate on restock `r` (the owning selling team's — the caller checked): the row, its Riwayat row, a
 * reshipping's inbound parcel. Returns the row and the parcel (wire, the owner's reading). */
export function recordResolution(r: RestockFacts, req: ResolutionCreateIn) {
  const s = restockResolutionScenario;
  takesResolutions(r);
  if (req.type === T.RETURN && r.status === RS.LOST) throw precondition("a lost restock takes no return — nothing came to send back");
  if (req.type === T.UNSPECIFIED) throw invalid("type: required");
  if (req.type === T.REFUND && (req.refundAmount <= 0 || req.financeAccountId === 0n)) {
    throw invalid("a refund names its amount and the account it goes into");
  }
  if (req.type === T.RESHIPPING && (!req.reshipping || req.reshipping.lines.length === 0 || req.reshipping.shipmentChannelId === 0n)) {
    throw invalid("a reshipping names its lines and its courier");
  }
  if (req.type === T.RETURN && req.customShipmentId === 0n) throw invalid("a return names its reship parcel");

  s.nextResolution += 1n;
  const row: ResolutionRow = {
    id: s.nextResolution,
    restockId: r.id,
    type: req.type,
    note: req.note,
    refundAmount: req.type === T.REFUND ? req.refundAmount : 0,
    financeAccountId: req.type === T.REFUND ? req.financeAccountId : 0n,
    customShipmentId: req.type === T.RETURN ? req.customShipmentId : 0n,
    inventoryTransactionId: 0n,
    createdByUserId: s.actor,
    createdAtUnix: nowUnix(),
  };

  let parcel: InboundRow | undefined;
  if (req.type === T.RESHIPPING && req.reshipping) {
    const sent = req.reshipping;
    s.nextParcel += 1n;
    parcel = {
      id: s.nextParcel,
      teamId: r.requestingTeamId,
      warehouseId: sent.warehouseId > 0n ? sent.warehouseId : r.warehouseId,
      restockId: r.id,
      resolutionId: row.id,
      status: S.ON_THE_WAY,
      // The server's pick: the one supplier every restock line names.
      supplierId: sent.supplierId > 0n ? sent.supplierId : (r.items.find((l) => l.supplierId > 0n)?.supplierId ?? 0n),
      shipmentChannelId: sent.shipmentChannelId,
      resi: sent.resi,
      items: sent.lines.map((l) => {
        const product = products.find((p) => p.id === l.productId);
        s.nextLine += 1n;
        return {
          id: s.nextLine,
          productId: l.productId,
          productCode: product?.productCode ?? "",
          name: product?.name ?? "",
          quantity: l.count,
          priceUnit: l.priceUnit,
          rackId: 0n,
        };
      }),
      shippingCost: 0,
      chargeNote: "",
      createdByUserId: s.actor,
      createdAtUnix: row.createdAtUnix,
      arrivedByUserId: 0n,
      arrivedAtUnix: 0n,
      receivedByUserId: 0n,
      receivedAtUnix: 0n,
      lostByUserId: 0n,
      lostAtUnix: 0n,
      lostReason: "",
      restockLost: r.status === RS.LOST,
    };
    row.customShipmentId = parcel.id;
    s.parcels.push(parcel);
  }

  s.resolutions.push(row);
  writeLog({ ...resolutionLog(0n, row) });

  return { row, parcel };
}

/** The RETURN row CustomShipmentCreate's `resolution` records with the outbound reship parcel it creates. */
export function recordReturnWithParcel(restockId: bigint, note: string, parcelId: bigint) {
  const s = restockResolutionScenario;
  s.nextResolution += 1n;
  const row: ResolutionRow = {
    id: s.nextResolution,
    restockId,
    type: T.RETURN,
    note,
    refundAmount: 0,
    financeAccountId: 0n,
    customShipmentId: parcelId,
    inventoryTransactionId: 0n,
    createdByUserId: s.actor,
    createdAtUnix: nowUnix(),
  };
  s.resolutions.push(row);
  writeLog({ ...resolutionLog(0n, row) });

  return row;
}

/** RestockRequestSettle on `r` (the owning selling team's — the caller checked). The caller takes the problem tags off. */
export function settleRestock(r: RestockFacts) {
  const s = restockResolutionScenario;
  if (s.settled.has(r.id.toString())) throw precondition("the restock is already settled");
  takesResolutions(r);
  const atUnix = nowUnix();
  s.settled.set(r.id.toString(), { userId: s.actor, atUnix });
  writeLog({ restockId: r.id, kind: RestockLogKind.SETTLED, actorUserId: s.actor, atUnix, description: "settled", changes: [] });
}

/**
 * A STORY'S SEED on top of the default one — 503 marked settled two days ago, then its reshipping #901 counted in by Budi
 * a day later with 1 of its 2 Beras short: the mark lifted and the Riwayat's REOPENED row written, as the server does.
 * The caller puts 503's tags as they then stand (both problem tags on, as before).
 */
export function settledThenReopenedForStory() {
  const s = restockResolutionScenario;
  const parcel = inboundById(901n)!;
  s.logs.push({ id: 9007n, restockId: 503n, kind: RestockLogKind.SETTLED, actorUserId: ANI, atUnix: daysAgo(1) - 3600n, description: "settled", changes: [] });
  parcel.status = S.RECEIVED;
  parcel.arrivedByUserId = BUDI;
  parcel.arrivedAtUnix = daysAgo(0) - 600n;
  parcel.receivedByUserId = BUDI;
  parcel.receivedAtUnix = daysAgo(0) - 600n;
  parcel.items[0]!.received = 1n;
  parcel.items[0]!.broken = 0n;
  parcel.items[0]!.rackId = 41n;
  s.logs.push({
    id: 9008n,
    restockId: 503n,
    kind: RestockLogKind.REOPENED,
    actorUserId: BUDI,
    atUnix: daysAgo(0) - 600n,
    description: "reopened",
    changes: [
      { field: CF.PARCEL, productId: 0n, productName: "", before: "", after: "901" },
      { field: CF.PARCEL_SHORT, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "", after: "1" },
    ],
  });
}

/** A STORY'S SEED — restock `restockId` marked settled by Ani an hour ago, with its Riwayat row (the caller takes its
 * problem tags off, as the settle did). */
export function settledForStory(restockId: bigint) {
  const s = restockResolutionScenario;
  const atUnix = nowUnix() - 3600n;
  s.settled.set(restockId.toString(), { userId: ANI, atUnix });
  writeLog({ restockId, kind: RestockLogKind.SETTLED, actorUserId: ANI, atUnix, description: "settled", changes: [] });
}

/** Whether the server holds `restockId` settled now (a story's pin). */
export const isSettled = (restockId: bigint) => restockResolutionScenario.settled.has(restockId.toString());

/** The restock's Riwayat settlement rows' kinds, in order (a story's pin). */
export const settlementKindsOf = (restockId: bigint) =>
  restockResolutionScenario.logs.filter((l) => l.restockId === restockId).sort((a, b) => (a.atUnix < b.atUnix ? -1 : a.atUnix > b.atUnix ? 1 : 0)).map((l) => l.kind);

/** The RETURN row an outbound parcel rides — its `resolution_id` on the wire; 0 = none. */
export const returnRowOf = (parcelId: bigint) =>
  restockResolutionScenario.resolutions.find((r) => r.type === T.RETURN && r.customShipmentId === parcelId)?.id ?? 0n;

/** The restock's resolution rows (for a story's pin). */
export const resolutionsOn = (restockId: bigint) => restockResolutionScenario.resolutions.filter((r) => r.restockId === restockId);

// ── The inbound parcel's side (customShipmentStub.ts) ──────────────────────────────────────────────────────────────

/** Which side of an inbound parcel the team reads it from — root reads every one. */
export function inboundSideOf(p: InboundRow, teamId: bigint): "owner" | "warehouse" | "root" | null {
  if (teamId === 1n) return "root";
  if (p.teamId === teamId) return "owner";
  if (p.warehouseId === teamId) return "warehouse";
  return null;
}

/** The parcel as THIS reader receives it — a warehouse is answered no seller price (UNSET). */
export function inboundWire(p: InboundRow, teamId: bigint) {
  const moneyFree = inboundSideOf(p, teamId) === "warehouse";

  return {
    id: p.id,
    teamId: p.teamId,
    warehouseId: p.warehouseId,
    kind: K.SUPPLIER_RESHIPPING,
    status: p.status,
    direction: D.INBOUND,
    restockId: p.restockId,
    resolutionId: p.resolutionId,
    supplierId: p.supplierId,
    shipmentChannelId: p.shipmentChannelId,
    payer: P.WAREHOUSE,
    financeAccountId: 0n,
    shippingCost: p.shippingCost,
    chargeNote: p.chargeNote,
    resi: p.resi,
    note: "",
    items: p.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productCode: i.productCode,
      name: i.name,
      quantity: i.quantity,
      priceUnit: moneyFree ? undefined : i.priceUnit,
      received: i.received,
      broken: i.broken,
      rackId: i.rackId,
    })),
    total: undefined,
    logs: [],
    createdByUserId: p.createdByUserId,
    createdAtUnix: p.createdAtUnix,
    arrivedByUserId: p.arrivedByUserId,
    arrivedAtUnix: p.arrivedAtUnix,
    receivedByUserId: p.receivedByUserId,
    receivedAtUnix: p.receivedAtUnix,
    lostByUserId: p.lostByUserId,
    lostAtUnix: p.lostAtUnix,
    lostReason: p.lostReason,
  };
}

/**
 * The inbound parcels CustomShipmentList answers this reader — the direction as the server reads it: unasked, the
 * selling team and root read both ways (so these come among the outbound ones), a warehouse OUTBOUND only; INBOUND asks
 * for them; OUTBOUND leaves them out. The kind, status, warehouse and free text narrow as they do the outbound rows.
 */
export function inboundForList(
  teamId: bigint,
  readerIsWarehouse: boolean,
  f: { status?: S; kind?: K; q?: string; warehouseId?: bigint; direction?: D } | undefined,
): InboundRow[] {
  const direction = f?.direction ?? D.UNSPECIFIED;
  if (direction === D.OUTBOUND) return [];
  if (direction === D.UNSPECIFIED && readerIsWarehouse) return [];
  if (f?.kind && f.kind !== K.SUPPLIER_RESHIPPING) return [];
  const needle = (f?.q ?? "").trim().toLowerCase().replace(/^#/, "");

  return restockResolutionScenario.parcels
    .filter((p) => inboundSideOf(p, teamId) !== null)
    .filter((p) => !f?.status || p.status === f.status)
    .filter((p) => !f?.warehouseId || p.warehouseId === f.warehouseId)
    .filter(
      (p) =>
        needle === "" ||
        p.id.toString() === needle ||
        p.resi.toLowerCase().includes(needle) ||
        p.items.some((i) => i.productCode.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle)),
    );
}

export const inboundById = (id: bigint) => restockResolutionScenario.parcels.find((p) => p.id === id);

/** A parcel the team holds as `side` — anything else NotFound, as lockInboundParcel. */
function heldInbound(id: bigint, teamId: bigint, side: "owner" | "warehouse"): InboundRow {
  const p = inboundById(id);
  if (!p || (side === "owner" ? p.teamId !== teamId : p.warehouseId !== teamId)) throw notFound();

  return p;
}

export function setInboundResi(req: { teamId: bigint; id: bigint; resi: string }) {
  const p = heldInbound(req.id, req.teamId, "owner");
  if (p.status !== S.ON_THE_WAY) throw precondition("the resi is editable until the parcel arrives");
  p.resi = req.resi;

  return p;
}

export function setInboundPrices(req: { teamId: bigint; id: bigint; lines: { itemId: bigint; priceUnit: number }[] }) {
  const p = heldInbound(req.id, req.teamId, "owner");
  if (p.status !== S.ON_THE_WAY && p.status !== S.ARRIVED) throw precondition("the prices are editable until the parcel is counted in");
  for (const line of req.lines) {
    const item = p.items.find((i) => i.id === line.itemId);
    if (!item) throw invalid("a line not on this parcel");
    if (line.priceUnit <= 0) throw invalid("a price above 0");
    item.priceUnit = line.priceUnit;
  }

  return p;
}

export function markInboundLost(req: { teamId: bigint; id: bigint; reason: string }) {
  const p = heldInbound(req.id, req.teamId, "owner");
  if (p.status !== S.ON_THE_WAY) throw precondition("only a parcel on its way is given up as lost");
  p.status = S.LOST;
  p.lostByUserId = restockResolutionScenario.actor;
  p.lostAtUnix = nowUnix();
  p.lostReason = req.reason;

  return p;
}

export function arriveInbound(req: { teamId: bigint; id: bigint; doorCharge: number; doorChargeNote: string }) {
  const p = heldInbound(req.id, req.teamId, "warehouse");
  if (p.status !== S.ON_THE_WAY && p.status !== S.LOST) throw precondition("only a parcel on its way, or a lost one, is set arrived");
  // What the courier's charge was for is optional (the-couriers-charge-note-is-optional) — never refused.
  p.status = S.ARRIVED;
  p.arrivedByUserId = restockResolutionScenario.actor;
  p.arrivedAtUnix = nowUnix();
  p.shippingCost = req.doorCharge;
  p.chargeNote = req.doorChargeNote;

  return p;
}

/**
 * Terima — the count in: every line once, received ≤ sent, broken ≤ received, good units on a rack. A short or broken
 * count on a SETTLED restock reopens it: the mark lifted and the REOPENED Riwayat row (the parcel, per product what was
 * short and broken) — the caller puts the problem tags back on a received one (restockTagScenario.putProblemTags).
 * Returns the parcel and whether it reopened, and what it found.
 */
export function receiveInbound(req: {
  teamId: bigint;
  id: bigint;
  lines: { itemId: bigint; received: bigint; broken: bigint; rackId: bigint }[];
  doorCharge: number;
  doorChargeNote: string;
}) {
  const s = restockResolutionScenario;
  const p = heldInbound(req.id, req.teamId, "warehouse");
  if (p.status !== S.ON_THE_WAY && p.status !== S.ARRIVED) throw precondition("only a parcel on its way or at the door is counted in");
  if (req.lines.length !== p.items.length) throw invalid("every line once");
  for (const line of req.lines) {
    const item = p.items.find((i) => i.id === line.itemId);
    if (!item) throw invalid("a line not on this parcel");
    if (line.received > item.quantity) throw invalid("more than the line says");
    if (line.broken > line.received) throw invalid("broken at most received");
    if (line.received - line.broken > 0n && line.rackId === 0n) throw invalid("good units go on a rack");
  }

  let short = false;
  let broken = false;
  for (const line of req.lines) {
    const item = p.items.find((i) => i.id === line.itemId)!;
    item.received = line.received;
    item.broken = line.broken;
    item.rackId = line.received - line.broken > 0n ? line.rackId : 0n;
    if (line.received < item.quantity) short = true;
    if (line.broken > 0n) broken = true;
  }
  const at = nowUnix();
  if (p.arrivedAtUnix === 0n) {
    p.arrivedByUserId = s.actor;
    p.arrivedAtUnix = at;
  }
  p.status = S.RECEIVED;
  p.receivedByUserId = s.actor;
  p.receivedAtUnix = at;
  p.shippingCost = req.doorCharge;
  p.chargeNote = req.doorChargeNote;

  let reopened = false;
  if ((short || broken) && s.settled.has(p.restockId.toString())) {
    s.settled.delete(p.restockId.toString());
    reopened = true;
    const changes: SettlementLogRow["changes"] = [{ field: CF.PARCEL, productId: 0n, productName: "", before: "", after: p.id.toString() }];
    for (const item of p.items) {
      const missing = item.quantity - (item.received ?? 0n);
      if (missing > 0n) changes.push({ field: CF.PARCEL_SHORT, productId: item.productId, productName: item.name, before: "", after: missing.toString() });
      if ((item.broken ?? 0n) > 0n) {
        changes.push({ field: CF.PARCEL_BROKEN, productId: item.productId, productName: item.name, before: "", after: (item.broken ?? 0n).toString() });
      }
    }
    writeLog({ restockId: p.restockId, kind: RestockLogKind.REOPENED, actorUserId: s.actor, atUnix: at, description: "reopened", changes });
  }

  return { parcel: p, reopened, short, broken };
}
