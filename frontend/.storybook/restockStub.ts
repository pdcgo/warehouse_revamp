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
//   the-problem-price-is-filled-by-the-system               a problem row's price = the landed unit price × n.
//   the-courier-is-paid-once-per-restock                    one charge, its note required when above 0.
//   the-couriers-charge-stays-out-of-total                  total = goods + shipping.
//   every-status-change-is-logged, edits-are-in-the-same-trail   every change appends a trail row; an edit's row is the
//                                                           bare "edited" with what it changed under it, each field
//                                                           before and after (editChanges = restock_log_changes.go).
//   a-product-appears-once-per-restock                      a product twice on one restock is refused.
//   the-notes-are-one-per-writer                            the note keeps its OWN writer and time: the raise stamps
//                                                           it, an edit or a note set only when it changes the note.
//   the-note-is-edited-in-any-status                        NoteSet takes the raising team's note in every status, the
//                                                           note alone, an edit's row with the note before and after;
//                                                           the same note again writes nothing.
//   the-warehouse-writes-its-own-note                       WarehouseNoteSet: the RECEIVING warehouse's own note (the
//                                                           selling team reads NotFound), every status — when it may be
//                                                           written is not decided — kept with its writer and time, an
//                                                           edit's row with the warehouse note before and after; the
//                                                           same note again writes nothing.
//   a-reference-in-use-stops-the-restock-form               Create, and an ongoing Update, refuse a resi or an Order ID
//                                                           another restock of the team holds, not cancelled, letter
//                                                           case and spaces aside — AlreadyExists with
//                                                           RestockReferenceInUse, naming the holder (00048's indexes).
//   a-restock-names-its-paying-account                      Create, and an ongoing Update that CHANGES the account,
//                                                           refuse one that is not the team's active operational
//                                                           account (payingAccountRefusal, the server's words).
//   the-received-count-prototype-is-accepted                Koreksi Jumlah Terima: the receiving warehouse's Owner or
//                                                           Admin (or Root, stamped) corrects an accepted restock —
//                                                           receivedCountScenario.ts plays the server's rules; the
//                                                           detail serves corrected_from, missing_by_correction, the
//                                                           money for the selling team only, the form's facts for the
//                                                           receiving warehouse only, and count_corrections.
//   the-restock-tags-prototype-is-accepted (#87)            the ten tag RPCs, a restock's `tags`, the list's `tag_ids`
//                                                           (ANY of) and Terima's problem tags — restockTagScenario.ts
//                                                           plays the server's rules; either side tags (visible).
//
// WRITEABLE: a restock raised in one step is on the list in the next. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import {
  RestockActorRole,
  RestockDateField,
  RestockLogChangeField as CF,
  RestockProblemType,
  RestockReference,
  RestockReferenceInUseSchema,
  RestockRequestByIdsDataType,
  RestockRequestListDataType,
  RestockRequestService,
  RestockRequestStatus as S,
} from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { unitHpp } from "../src/features/restock/counting";
import { payingAccountRefusal } from "./financialAccountStub";
import { racks } from "./fixtures";
import { type ChangeFixture, type LineFixture, type RestockFixture, restockFixtures } from "./restockFixtures";
import { SELF_ID } from "./userStub";
import {
  correctionFieldsOf,
  correctionRowsOf,
  postCorrection,
  resetReceivedCountScenario,
} from "./receivedCountScenario";
import { sessionScenario } from "./sessionScenario";
import { resetRestockAcceptScenario, restockAcceptScenario } from "./restockAcceptScenario";
import { brokenPhotoLink, doorPhotoScenario, resetDoorPhotoScenario, slipPhotoLink } from "./doorPhotoScenario";
import { resetRestockReadScenario, restockReadScenario } from "./restockReadScenario";
import { resetRestockExportScenario, restockExportScenario } from "./restockExportScenario";
import { resetRestockWriteScenario, restockWriteScenario } from "./restockWriteScenario";
import {
  carriesAnyTag,
  createTag,
  deleteTag,
  listTags,
  manageTags,
  putProblemTags,
  refuseUnlessRole,
  renameTag,
  resetRestockTagScenario,
  setTag,
  tagsOnWire,
  takeProblemTagsOff,
} from "./restockTagScenario";
import {
  inboundWire,
  recordResolution,
  recordResolutionCall,
  resetRestockResolutionScenario,
  resolutionFieldsOf,
  restockResolutionScenario,
  settleRestock,
  settledMatches,
  settlementLogsOf,
} from "./restockResolutionScenario";
import { RestockTagType } from "../src/gen/warehouse/inventory/v1/restock_tag_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";

let rows: RestockFixture[] = [];

/** `yyyy-mm-dd` naming a real day ("2026-02-30" does not). */
function isCalendarDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function resetRestockStub() {
  rows = structuredClone(restockFixtures);
  resetReceivedCountScenario();
  resetRestockAcceptScenario();
  resetRestockReadScenario();
  resetRestockExportScenario();
  resetRestockWriteScenario();
  resetDoorPhotoScenario();
  resetRestockTagScenario(rows);
  // The resolutions, settled marks, Riwayat rows and inbound parcels (backlog #101) — empty until a story seeds them.
  resetRestockResolutionScenario();
}

/**
 * For a story: restock `id` kept NO photo at the door — no slip with its charge, no broken units' photo — as a restock
 * accepted before the photos were kept, or with none taken. Returns the restore (a `beforeEach` returns it).
 */
export function withoutDoorPhotosForStory(id: bigint): () => void {
  const fixture = restockFixtures.find((r) => r.id === id);
  if (!fixture) throw new Error(`no restock fixture ${id}`);

  const saved = {
    slip: fixture.warehouseAdditionalCostFile,
    photos: fixture.items.map((l) => l.problems.map((p) => p.photoFile)),
  };
  fixture.warehouseAdditionalCostFile = "";
  for (const l of fixture.items) for (const p of l.problems) p.photoFile = "";
  resetRestockStub();

  return () => {
    fixture.warehouseAdditionalCostFile = saved.slip;
    fixture.items.forEach((l, i) => l.problems.forEach((p, j) => (p.photoFile = saved.photos[i]![j])));
    resetRestockStub();
  };
}

resetRestockStub();

/**
 * For a story: restock `id` was ACCEPTED at `acceptedAtUnix` with the courier's charge `charge` — what the warehouse list's
 * COD card sums (the-warehouse-sees-the-cod-it-paid). The fixtures' own dates run from today, so a story about "this
 * month" places its restocks itself.
 */
export function restockCodPaidForStory(id: bigint, charge: number, acceptedAtUnix: bigint) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  row.status = S.ACCEPTED;
  row.warehouseAdditionalCost = charge;
  row.warehouseAdditionalCostNote = charge > 0 ? "Ongkos bongkar di gudang" : "";
  row.acceptedAtUnix = acceptedAtUnix;
}

/** For a story: who raised restock `id` — e.g. a former user, to show the list naming them (erase-keeps-the-row). */
export function restockRaisedByForStory(id: bigint, userId: bigint) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  row.createdByUserId = userId;
}

/**
 * For a story: who signed for (`arrived`) or counted in (`accepted`) restock `id` — the person the lists' by-lines name.
 * Pair it with `restockLogByForStory` on that step's trail row for its override flag.
 */
export function restockStepByForStory(id: bigint, step: "arrived" | "accepted", userId: bigint) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  if (step === "arrived") row.arrivedByUserId = userId;
  else row.acceptedByUserId = userId;
}

/**
 * For a story: who wrote restock `id`'s note, and when (the-notes-are-one-per-writer) — e.g. Root from outside the team,
 * or `0n, 0n` for a note written before its writer was kept.
 */
export function restockNoteByForStory(id: bigint, userId: bigint, atUnix: bigint, isOverride = false) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  row.noteByUserId = userId;
  row.noteAtUnix = atUnix;
  row.noteByIsOverride = isOverride;
}

/**
 * For a story: the receiving warehouse's own note on restock `id`, who wrote it and when
 * (the-warehouse-writes-its-own-note) — e.g. Root from outside the warehouse.
 */
export function restockWarehouseNoteForStory(id: bigint, note: string, userId: bigint, atUnix: bigint, isOverride = false) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  row.warehouseNote = note;
  row.warehouseNoteByUserId = userId;
  row.warehouseNoteAtUnix = atUnix;
  row.warehouseNoteByIsOverride = isOverride;
}

/**
 * For a story: who took ONE step of restock `id`'s timeline (the trail row `logId`), and whether it was Root or the
 * System Administrator from outside the team — served as `is_override`, the "by Root team" badge.
 */
export function restockLogByForStory(id: bigint, logId: bigint, userId: bigint, isOverride: boolean) {
  const log = rows.find((r) => r.id === id)?.logs.find((l) => l.id === logId);
  if (!log) throw new Error(`no trail row ${logId} on restock ${id} in the stub`);
  log.actorUserId = userId;
  log.isOverride = isOverride;
}

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

// a-restock-names-its-paying-account: the account must be one of the team's active operational ones — the server's
// FailedPrecondition sentence, from the financial account stub's live table (so a story may unmark one mid-flight).
function refuseAccount(teamId: bigint, accountId: bigint) {
  const refused = payingAccountRefusal(teamId, accountId);
  if (refused) throw precondition(refused);
}

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

// AN ACCEPTED RESTOCK'S LABELS — one per placement its good units went to, each with its batch's price (the landed unit
// price the accept minted the batch at); the broken and missing units, which got none, counted. RestockRequestLabels and
// RestockRequestByIds' LABELS slice both answer it, as the server's one builder does.
function labelSetOf(r: RestockFixture) {
  const labels = r.items.flatMap((l) => {
    const hpp = goodOf(l) > 0n ? landedOf(r, l) : 0;

    return l.placements.map((p) => ({
      productId: l.productId,
      productCode: l.productCode,
      name: l.name,
      batchId: l.id,
      quantity: p.quantity,
      placementCode: racks.find((rack) => rack.id === p.placementId)?.code ?? "",
      hpp,
    }));
  });
  const excluded = r.items.reduce((s, l) => s + l.problems.reduce((t, p) => t + p.count, 0n), 0n);

  return { receivedAtUnix: r.acceptedAtUnix, labels, excludedCount: excluded };
}

function appendLog(r: RestockFixture, from: S, to: S, description: string, changes?: ChangeFixture[]) {
  const id = r.logs.reduce((max, l) => (l.id > max ? l.id : max), 0n) + 1n;

  r.logs.push({ id, fromStatus: from, toStatus: to, actorUserId: SELF_ID, description, atUnix: now(), changes });
}

// WHAT AN EDIT CHANGES — the server's restockEditChanges (restock_log_changes.go), read before the edit is applied: every
// field that differs, the restock's own first, then the lines in the order sent (an added one says its count and total,
// then its note, supplier and store when given), then the lines removed. A unit price, the totals and a line's name are
// not changes of their own. An id is decimal text, "" for none.
function editChanges(r: RestockFixture, req: UpdateIn): ChangeFixture[] {
  const out: ChangeFixture[] = [];
  const id = (v: bigint) => (v === 0n ? "" : v.toString());
  const amount = (v: number) => String(v);
  const change = (field: CF, productId: bigint, productName: string, before: string, after: string) => {
    if (before !== after) out.push({ field, productId, productName, before, after });
  };

  change(CF.WAREHOUSE, 0n, "", id(r.warehouseId), id(req.warehouseId));
  change(CF.RECEIPT, 0n, "", r.receipt, req.receipt);
  change(CF.RECEIPT_FILE, 0n, "", r.receiptFile, req.receiptFile);
  change(CF.SHIPMENT, 0n, "", id(r.shipmentId), id(req.shipmentId));
  change(CF.INVOICE_REF, 0n, "", r.invoiceRefId, req.invoiceRefId);
  change(CF.FINANCE_ACCOUNT, 0n, "", id(r.financeAccountId), id(req.financeAccountId));
  change(CF.SHIPMENT_COST, 0n, "", amount(r.shipmentCost), amount(req.shipmentCost));
  change(CF.NOTE, 0n, "", r.note, req.note);

  for (const it of req.items) {
    const old = r.items.find((l) => l.productId === it.productId);
    if (!old) {
      change(CF.LINE_ADDED, it.productId, it.name, "", it.count.toString());
      out.push({ field: CF.LINE_TOTAL, productId: it.productId, productName: it.name, before: "", after: amount(it.total) });
      change(CF.LINE_NOTE, it.productId, it.name, "", it.note);
      change(CF.LINE_SUPPLIER, it.productId, it.name, "", id(it.supplierId));
      change(CF.LINE_STORE, it.productId, it.name, "", id(it.supplierChannelId));
      continue;
    }

    change(CF.LINE_COUNT, it.productId, it.name, old.count.toString(), it.count.toString());
    change(CF.LINE_TOTAL, it.productId, it.name, amount(old.total), amount(it.total));
    change(CF.LINE_NOTE, it.productId, it.name, old.note, it.note);
    change(CF.LINE_SUPPLIER, it.productId, it.name, id(old.supplierId), id(it.supplierId));
    change(CF.LINE_STORE, it.productId, it.name, id(old.supplierChannelId), id(it.supplierChannelId));
  }

  for (const old of r.items) {
    if (!req.items.some((it) => it.productId === old.productId)) {
      change(CF.LINE_REMOVED, old.productId, old.name, old.count.toString(), "");
    }
  }

  return out;
}

const goodOf = (l: LineFixture) => {
  const broken = l.problems.filter((p) => p.type === RestockProblemType.BROKEN).reduce((s, p) => s + p.count, 0n);

  return l.receivedCount - broken;
};

// The landed unit price of one line — the line's own price plus its share of the restock's costs over every unit
// ordered (all-qty-is-every-unit-ordered): the batch's price, and a broken or missing unit's.
function landedOf(r: RestockFixture, l: LineFixture): number {
  const allQty = r.items.reduce((s, x) => s + x.count, 0n);

  return unitHpp(l.total, l.count, r.shipmentCost + r.warehouseAdditionalCost, allQty);
}

// A line's door rows as a LIST row carries them (restock_request_list.go withRestockProblemCounts): the units of each kind,
// summed, in the server's order (by the kind's word — broken, then missing) — nothing else.
function listProblemCounts(l: LineFixture) {
  const sum = (type: RestockProblemType) => l.problems.filter((p) => p.type === type).reduce((s, p) => s + p.count, 0n);

  return [RestockProblemType.BROKEN, RestockProblemType.MISSING]
    .map((type) => ({ type, count: sum(type) }))
    .filter((p) => p.count > 0n);
}

// The trail row that moved restock `r` INTO `to` — never an edit, which keeps the status.
const stepLog = (r: RestockFixture, to: S) => r.logs.find((l) => l.toStatus === to && l.fromStatus !== l.toStatus);

// The restock as the wire carries it — prices worked out, totals summed, the trail only when asked. Money is a
// double, unrounded, as the server stores it (money-is-double-in-the-api-too). The detail (`withLogs`) carries Koreksi
// Jumlah Terima as `reader` reads it: the money for the selling team only, the form's facts for the receiving warehouse
// on an accepted restock only (restock_count_corrections_read.go).
function toWire(r: RestockFixture, withLogs: boolean, reader?: bigint) {
  const withMoney = reader === r.requestingTeamId;
  const withFacts = reader === r.warehouseId && r.status === S.ACCEPTED;
  const items = r.items.map((l) => {
    const landed = landedOf(r, l);

    return {
      ...l,
      priceUnit: l.count > 0n ? l.total / Number(l.count) : 0,
      // A LIST ROW (no trail) carries what the real list sends of the door's rows — on an accepted restock only, each
      // kind's units alone: no price, total, note or photo, and no placements (restock_request_list.go
      // withRestockProblemCounts, backlog #89); the detail reads them whole. So a list screen reading more of them than
      // the list sends fails here first.
      problems: withLogs
        ? l.problems.map((p) => ({ ...p, priceUnit: landed, total: landed * Number(p.count) }))
        : r.status === S.ACCEPTED
          ? listProblemCounts(l)
          : [],
      placements: withLogs ? l.placements : [],
      ...(withLogs ? correctionFieldsOf("restock", r.id, l.id, withMoney, withFacts) : {}),
    };
  });
  const subtotal = r.items.reduce((s, l) => s + l.total, 0);

  return {
    ...r,
    items,
    subtotal,
    total: subtotal + r.shipmentCost,
    // The trail — and its settlement rows (backlog #101: a resolution, a settle, a reopen; restockResolutionScenario.ts),
    // by their time.
    logs: withLogs ? [...r.logs, ...settlementLogsOf(r.id, r.status)].sort((a, b) => (a.atUnix < b.atUnix ? -1 : a.atUnix > b.atUnix ? 1 : 0)) : [],
    // Its resolution rows (the detail), their count and the settled mark (both) — money for the owner only (#101).
    ...resolutionFieldsOf(r, withLogs, reader),
    // Its tags (#87), on the list's rows and the detail alike.
    tags: tagsOnWire(r.id),
    countCorrections: withLogs ? correctionRowsOf("restock", r.id, withMoney) : [],
    // Each by-line's flag, as the server reads it for the list (an-override-shows-a-platform-badge): the create's is the
    // trail's FIRST row; the arrive's is the row that moved it to arrived — or, counted straight from ongoing, the
    // accept's; the accept's is the row that moved it to accepted. An edit keeps the status and is no step.
    createdByIsOverride: r.logs[0]?.isOverride === true,
    arrivedByIsOverride: (stepLog(r, S.ARRIVED) ?? stepLog(r, S.ACCEPTED))?.isOverride === true,
    acceptedByIsOverride: stepLog(r, S.ACCEPTED)?.isOverride === true,
  };
}

type LineIn = {
  productId: bigint;
  productCode: string;
  name: string;
  count: bigint;
  total: number;
  supplierId: bigint;
  supplierChannelId: bigint;
  note: string;
};

// The fields of an update editChanges compares — the request as the router hands it.
type UpdateIn = {
  warehouseId: bigint;
  receipt: string;
  receiptFile: string;
  shipmentId: bigint;
  invoiceRefId: string;
  financeAccountId: bigint;
  shipmentCost: number;
  note: string;
  items: LineIn[];
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
    productCode: it.productCode,
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

/**
 * For a story: ANOTHER restock of `teamId` raised with this resi and/or Order ID right now — the twin save that lands
 * after the form asked the list and before its own save, so only the server's refusal can catch it. Returns its id.
 */
export function raiseTwinRestockForStory(teamId: bigint, refs: { receipt?: string; invoiceRefId?: string }): bigint {
  const source = rows.find((r) => r.requestingTeamId === teamId);
  if (!source) throw new Error(`no restock of team ${teamId} in the stub to copy`);

  const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
  rows.push({
    ...structuredClone(source),
    id,
    status: S.ONGOING,
    receipt: refs.receipt ?? "",
    invoiceRefId: refs.invoiceRefId ?? "",
    createdAtUnix: now(),
    logs: [],
  });

  return id;
}

// a-reference-in-use-stops-the-restock-form, as inventory 00048's unique indexes keep it: each reference on its own,
// against the team's other restocks that are not cancelled, letter case and the spaces around it aside; an empty one
// holds nothing. The server's AlreadyExists and its RestockReferenceInUse detail, naming each holder.
function refuseHeldReferences(teamId: bigint, exceptId: bigint, receipt: string, invoiceRefId: string) {
  const bare = (v: string) => v.replace(/^ +| +$/g, "").toLowerCase();
  const holderOf = (pick: (r: RestockFixture) => string, value: string) =>
    bare(value) === ""
      ? undefined
      : rows
          .filter((r) => r.requestingTeamId === teamId && r.id !== exceptId && r.status !== S.CANCELLED)
          .filter((r) => bare(pick(r)) === bare(value))
          .sort((a, b) => (a.id > b.id ? -1 : 1))[0];

  const held = [
    { reference: RestockReference.RECEIPT, word: "resi", holder: holderOf((r) => r.receipt, receipt) },
    { reference: RestockReference.INVOICE_REF, word: "Order ID", holder: holderOf((r) => r.invoiceRefId, invoiceRefId) },
  ].filter((h) => h.holder !== undefined);
  if (held.length === 0) return;

  const words = held.map((h) => `the ${h.word} is already on restock #${h.holder!.id} (${S[h.holder!.status].toLowerCase()})`);

  throw new ConnectError(
    `a resi or an Order ID of this restock is already on another restock of this team: ${words.join("; ")}`,
    Code.AlreadyExists,
    undefined,
    [
      {
        desc: RestockReferenceInUseSchema,
        value: {
          held: held.map((h) => ({ reference: h.reference, holderId: h.holder!.id, holderStatus: h.holder!.status })),
        },
      },
    ],
  );
}

// Change one restock for a story — a case the fixtures do not hold (a restock with no order id). Call it from the
// story's `beforeEach`, which runs after preview's reset, so the change lasts that story only.
export function patchRestock(id: bigint, fields: Partial<Pick<RestockFixture, "invoiceRefId" | "receipt" | "logs">>) {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no restock ${id}`);

  Object.assign(found, fields);
}

// One correction of restock `r` by its receiving warehouse — judged, posted, the lines' counts moved.
function correctRestock(
  r: RestockFixture,
  req: { reason: string; lines: { itemId: bigint; expectedReceivedCount: bigint; receivedCount: bigint; placementId: bigint }[] },
) {
  if (r.status !== S.ACCEPTED) {
    throw precondition(`only an accepted stock-in's received count is corrected: this restock is ${S[r.status].toLowerCase()}`);
  }

  const made = postCorrection(
    "restock",
    r.id,
    r.warehouseId,
    req,
    (itemId) => {
      const l = r.items.find((x) => x.id === itemId);
      if (!l) return undefined;
      const broken = l.problems.filter((p) => p.type === RestockProblemType.BROKEN).reduce((s, p) => s + p.count, 0n);

      return {
        itemId,
        productId: l.productId,
        productCode: l.productCode,
        received: l.receivedCount,
        broken,
        ceiling: l.count,
        priceUnit: landedOf(r, l),
      };
    },
    "ordered",
  );

  for (const c of made) {
    const l = r.items.find((x) => x.id === c.itemId)!;
    l.receivedCount = c.toCount;
  }

  return made;
}

/**
 * For a story: a Koreksi Jumlah Terima ALREADY MADE on restock `id` — as Gudang Pusat's Owner would post it, by `userId`
 * (Dewi, 64, unless said), so a result story opens on it (the selling team's view, the batch's history), or a form that
 * was opened before it goes stale. Each line: its item, the real count and the rack.
 */
export function restockCorrectedForStory(
  id: bigint,
  lines: { itemId: bigint; to: bigint; rackId: bigint }[],
  reason: string,
  userId = 64n,
  isOverride = false,
) {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no restock ${id} in the stub`);
  const role = sessionScenario.role;
  sessionScenario.role = Role.WAREHOUSE_OWNER;
  try {
    const made = correctRestock(r, {
      reason,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        expectedReceivedCount: r.items.find((x) => x.id === l.itemId)?.receivedCount ?? 0n,
        receivedCount: l.to,
        placementId: l.rackId,
      })),
    });
    for (const c of made) {
      c.actorUserId = userId;
      c.isOverride = isOverride;
    }
  } finally {
    sessionScenario.role = role;
  }
}

// The words the server writes (san_money.Text): the exact figure, up to 3 decimals — never rounded to the rupiah.
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 3 })}`;

type ListFilter = Parameters<NonNullable<typeof restockRequestService.restockRequestList>>[0]["filter"];

// THE LIST'S ONE PREDICATE, as restock_list_scope.go: both sides' scope and every filter. RestockRequestList pages it and
// RestockSellingStat counts it (status cleared, the raising side only), so the stub's cards and rows cannot disagree
// either.
function inListScope(r: RestockFixture, teamId: bigint, f: ListFilter): boolean {
  const q = (f?.q ?? "").trim().toLowerCase();
  const idQuery = q.replace(/^#/, "");
  const field = f?.dateField ?? RestockDateField.UNSPECIFIED;

  if (r.requestingTeamId !== teamId && r.warehouseId !== teamId) return false;
  if (f?.status && r.status !== f.status) return false;
  if (f?.productId && !r.items.some((l) => l.productId === f.productId)) return false;
  if (f?.warehouseId && r.warehouseId !== f.warehouseId) return false;
  if (f?.requestingTeamId && r.requestingTeamId !== f.requestingTeamId) return false;
  if (f?.createdByUserId && r.createdByUserId !== f.createdByUserId) return false;
  if (f?.acceptedByUserId && r.acceptedByUserId !== f.acceptedByUserId) return false;
  // The courier: 0 = any; a restock naming none matches no pick.
  if (f?.shipmentId && r.shipmentId !== f.shipmentId) return false;
  // The tags (#87): none picked = any; else it carries ANY of them.
  if (!carriesAnyTag(r.id, f?.tagIds)) return false;
  // The settled mark (#101): the Hilang tab sends LOST + UNSETTLED.
  if (!settledMatches(r.id, f?.settled)) return false;

  if (f?.fromUnix || f?.toUnix) {
    const at = dateOf(r, field);
    if (at === 0n) return false;
    if ((f.fromUnix && at < f.fromUnix) || (f.toUnix && at > f.toUnix)) return false;
  }

  return (
    !q ||
    r.id.toString() === idQuery ||
    r.receipt.toLowerCase().includes(q) ||
    r.invoiceRefId.toLowerCase().includes(q) ||
    r.items.some((l) => l.productCode.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))
  );
}

// One pile of the selling statistics, as restock_selling_stat.go sums it: the pieces ORDERED (never received), the
// different products, the goods, the freight, the courier's charge (outside the value) and goods + freight.
function pileOfRestocks(status: S, restocks: RestockFixture[]) {
  const lines = restocks.flatMap((r) => r.items);
  const goods = lines.reduce((sum, l) => sum + l.total, 0);
  const shipping = restocks.reduce((sum, r) => sum + r.shipmentCost, 0);

  return {
    status,
    restockCount: BigInt(restocks.length),
    unitCount: lines.reduce((sum, l) => sum + l.count, 0n),
    productCount: BigInt(new Set(lines.map((l) => l.productId.toString())).size),
    goodsValue: goods,
    shipmentCost: shipping,
    courierCharge: restocks.reduce((sum, r) => sum + r.warehouseAdditionalCost, 0),
    value: goods + shipping,
  };
}

/**
 * For a story: restock `id` was paid from account `accountId` — 0 is one raised before naming its account was required.
 * Reset with the stub, per story.
 */
export function restockPaidFromForStory(id: bigint, accountId: bigint) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no restock ${id} in the stub`);
  row.financeAccountId = accountId;
}

export const restockRequestService: Partial<ServiceImpl<typeof RestockRequestService>> = {
  restockRequestCreate(req) {
    if (req.items.length === 0) throw invalid("items: at least one line is required");
    if (req.financeAccountId === 0n) throw invalid("finance_account_id: value is required");
    onceEach(req.items);
    refuseAccount(req.teamId, req.financeAccountId);
    refuseHeldReferences(req.teamId, 0n, req.receipt, req.invoiceRefId);

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
      warehouseAdditionalCost: 0,
      warehouseAdditionalCostNote: "",
      note: req.note,
      // The raise writes the note — empty or not — so its writer is the raiser (the-notes-are-one-per-writer).
      noteByUserId: SELF_ID,
      noteAtUnix: now(),
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

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestList(req) {
    restockResolutionScenario.listAsks.push({ status: req.filter?.status ?? S.UNSPECIFIED, settled: req.filter?.settled ?? 0 });
    const matched = rows
      .filter((r) => inListScope(r, req.teamId, req.filter))
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
    return { request: toWire(visible(req.teamId, req.requestId), true, req.teamId) };
  },

  // ── RESTOCK RESOLUTIONS (backlog #101) — the owning selling team's; restockResolutionScenario.ts plays the rules. ──
  restockResolutionCreate(req) {
    recordResolutionCall("RestockResolutionCreate", req);
    const r = raisedBy(req.teamId, req.restockId);
    const { row, parcel } = recordResolution(r, {
      teamId: req.teamId,
      restockId: req.restockId,
      type: req.type,
      note: req.note,
      refundAmount: req.refundAmount,
      financeAccountId: req.financeAccountId,
      customShipmentId: req.customShipmentId,
      reshipping: req.reshipping,
      idempotencyKey: req.idempotencyKey,
    });

    return {
      resolution: { ...row, refundAmount: row.refundAmount, createdByIsOverride: false },
      customShipment: parcel ? inboundWire(parcel, req.teamId) : undefined,
    };
  },

  restockRequestSettle(req) {
    recordResolutionCall("RestockRequestSettle", req);
    const r = raisedBy(req.teamId, req.requestId);
    settleRestock(r);
    // The app takes *Barang kurang* / *Barang rusak* off in the same step.
    takeProblemTagsOff(r.id);

    return { request: toWire(r, true, req.teamId) };
  },

  // KOREKSI JUMLAH TERIMA (restock_received_count_correct.go): the RECEIVING warehouse only (another's reads NotFound),
  // an accepted restock only, then the shared rules (receivedCountScenario.ts). The line's count becomes the real one;
  // the door's own problem rows never change — the correction's units are `missing_by_correction`.
  restockReceivedCountCorrect(req) {
    const r = comingTo(req.teamId, req.requestId);
    correctRestock(r, req);

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestUpdate(req) {
    // Which write a save called (restockWriteScenario.ts) — the edit form's, the whole restock.
    restockWriteScenario.writes.push({ rpc: "RestockRequestUpdate", teamId: req.teamId, requestId: req.requestId, note: req.note });
    const r = raisedBy(req.teamId, req.requestId);
    onceEach(req.items);

    if (r.status === S.ONGOING) {
      // Only a CHANGED account is judged — an unchanged one is the restock keeping what it holds.
      if (req.financeAccountId !== r.financeAccountId) refuseAccount(req.teamId, req.financeAccountId);
      refuseHeldReferences(req.teamId, r.id, req.receipt, req.invoiceRefId);
      const changes = editChanges(r, req);
      // The note's own writer moves only when this edit changes the note.
      if (req.note !== r.note) {
        r.noteByUserId = SELF_ID;
        r.noteAtUnix = now();
        r.noteByIsOverride = false;
      }
      r.warehouseId = req.warehouseId;
      r.receipt = req.receipt;
      r.receiptFile = req.receiptFile;
      r.shipmentId = req.shipmentId;
      r.invoiceRefId = req.invoiceRefId;
      r.financeAccountId = req.financeAccountId;
      r.shipmentCost = req.shipmentCost;
      r.note = req.note;
      r.items = newLines(r, req.items, r.items.length + 10);
      appendLog(r, S.ONGOING, S.ONGOING, "edited", changes);

      return { request: toWire(r, true, req.teamId) };
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

    const changes = editChanges(r, req);
    const next: LineFixture[] = [];

    for (const existing of r.items) {
      const incoming = req.items.find((it) => it.productId === existing.productId);
      if (!incoming) throw precondition("a line cannot be removed once the box has arrived — it is written as missing");
      if (incoming.supplierId !== existing.supplierId || incoming.supplierChannelId !== existing.supplierChannelId) {
        throw precondition("a line's store cannot change once the box has arrived");
      }
      next.push({ ...existing, count: incoming.count, total: incoming.total, note: incoming.note });
    }

    const added = req.items.filter((it) => !r.items.some((l) => l.productId === it.productId));
    for (const it of added) {
      if (it.note.trim() === "") throw invalid("a line added after the box arrived needs a note");
    }

    r.items = [...next, ...newLines(r, added, r.items.length + 20)];
    appendLog(r, S.ARRIVED, S.ARRIVED, "edited", changes);

    return { request: toWire(r, true, req.teamId) };
  },

  // THE NOTE ALONE, IN ANY STATUS (restock_request_note_set.go, the-note-is-edited-in-any-status): the raising team only
  // (the warehouse reads NotFound), every status; a changed note stamps its writer and is an edit's row with the note
  // before and after; the same note again writes nothing.
  restockRequestNoteSet(req) {
    // Which write a save called (restockWriteScenario.ts) — the note alone.
    restockWriteScenario.writes.push({ rpc: "RestockRequestNoteSet", teamId: req.teamId, requestId: req.requestId, note: req.note });
    const r = raisedBy(req.teamId, req.requestId);
    if (req.note !== r.note) {
      const changes: ChangeFixture[] = [{ field: CF.NOTE, productId: 0n, productName: "", before: r.note, after: req.note }];
      r.note = req.note;
      r.noteByUserId = SELF_ID;
      r.noteAtUnix = now();
      r.noteByIsOverride = false;
      appendLog(r, r.status, r.status, "edited", changes);
    }

    return { request: toWire(r, true, req.teamId) };
  },

  // THE RECEIVING WAREHOUSE'S OWN NOTE (restock_request_warehouse_note_set.go, the-warehouse-writes-its-own-note): the
  // receiving warehouse only (the raising team reads NotFound), every status; a changed note stamps its writer and is an
  // edit's row with the warehouse note before and after; the same note again writes nothing.
  restockRequestWarehouseNoteSet(req) {
    const r = comingTo(req.teamId, req.requestId);
    const before = r.warehouseNote ?? "";
    if (req.note !== before) {
      const changes: ChangeFixture[] = [
        { field: CF.WAREHOUSE_NOTE, productId: 0n, productName: "", before, after: req.note },
      ];
      r.warehouseNote = req.note;
      r.warehouseNoteByUserId = SELF_ID;
      r.warehouseNoteAtUnix = now();
      r.warehouseNoteByIsOverride = false;
      appendLog(r, r.status, r.status, "edited", changes);
    }

    return { request: toWire(r, true, req.teamId) };
  },

  // ── THE TAGS (#87) — restockTagScenario.ts plays the rules; a restock is tagged from EITHER side (visible). ──
  // A READ — the admin team's monitor reaches it too, as every restock read.
  restockTagList(req) {
    return listTags(req.q, req.page);
  },
  restockTagManageList(req) {
    refuseUnlessRole(true);
    return manageTags(req.q, req.page);
  },
  restockTagCreate(req) {
    refuseUnlessRole(false);
    return createTag(req.name, RestockTagType.CUSTOM);
  },
  restockTagSystemCreate(req) {
    refuseUnlessRole(true);
    return createTag(req.name, RestockTagType.SYSTEM);
  },
  restockTagRename(req) {
    refuseUnlessRole(true);
    return renameTag(req.tagId, req.name);
  },
  restockTagDelete(req) {
    refuseUnlessRole(true);
    return deleteTag(req.tagId);
  },
  restockRequestTagAdd(req) {
    refuseUnlessRole(false);
    visible(req.teamId, req.requestId);
    return setTag(req.teamId, req.requestId, req.tagId, false, true);
  },
  restockRequestTagRemove(req) {
    refuseUnlessRole(false);
    visible(req.teamId, req.requestId);
    return setTag(req.teamId, req.requestId, req.tagId, false, false);
  },
  restockRequestSystemTagAdd(req) {
    refuseUnlessRole(true);
    visible(req.teamId, req.requestId);
    return setTag(req.teamId, req.requestId, req.tagId, true, true);
  },
  restockRequestSystemTagRemove(req) {
    refuseUnlessRole(true);
    visible(req.teamId, req.requestId);
    return setTag(req.teamId, req.requestId, req.tagId, true, false);
  },

  restockRequestArrive(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ONGOING && r.status !== S.LOST) throw precondition("only an ongoing or lost restock can be signed for");
    // THE COURIER'S CHARGE NOTED AT THE DOOR, as the server checks and keeps it
    // (the-courier-charge-is-noted-at-tiba-and-final-at-terima): Terima's rules — a note once above 0, the slip only with a
    // charge. A story may call the stub with a plain object, so an absent field reads as none.
    const charge = req.warehouseAdditionalCost ?? 0;
    const note = req.warehouseAdditionalCostNote ?? "";
    if (charge > 0 && note.trim() === "") throw invalid("the courier's charge needs a note");

    const from = r.status;
    r.status = S.ARRIVED;
    r.arrivedByUserId = SELF_ID;
    r.arrivedAtUnix = now();
    r.warehouseAdditionalCost = charge;
    r.warehouseAdditionalCostNote = note;
    r.warehouseAdditionalCostFile = charge > 0 ? (req.warehouseAdditionalCostFile ?? "") : "";
    appendLog(r, from, S.ARRIVED, from === S.LOST ? "signed for the box — it turned up after all" : "signed for the box");

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestAccept(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ONGOING && r.status !== S.ARRIVED) {
      throw precondition("restock request can only be accepted while ongoing or arrived");
    }
    if (req.warehouseAdditionalCost > 0 && req.warehouseAdditionalCostNote.trim() === "") {
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
      // The expiry read off the box: a Jakarta day or nothing (the proto's pattern, then the handler's calendar check).
      // A story may call the stub with a plain object (no proto defaults), so an absent expiry is undefined as well as "".
      if (c.expiresOn && !isCalendarDay(c.expiresOn)) throw invalid("the expiry is not a day on the calendar");
      if (placed !== good) throw invalid("the placements must add up to the good units");
      for (const p of c.placements) {
        if (!racks.some((rack) => rack.id === p.placementId && rack.warehouseId === r.warehouseId)) {
          throw new ConnectError("rack not found", Code.NotFound);
        }
      }
    }

    let broken = 0n;
    let missing = 0n;

    restockAcceptScenario.expiries.push(Object.fromEntries(req.lines.map((l) => [l.itemId.toString(), l.expiresOn])));
    // The door's photos as SENT — a story may call the stub with a plain object, so an absent one is "" too.
    restockAcceptScenario.photos.push({
      broken: Object.fromEntries(req.lines.map((l) => [l.itemId.toString(), l.brokenPhotoFile ?? ""])),
      slip: req.warehouseAdditionalCostFile ?? "",
    });

    for (const l of r.items) {
      const c = counted.get(l.id.toString())!;
      l.receivedCount = c.receivedCount;
      l.placements = c.placements.map((p) => ({ placementId: p.placementId, quantity: p.quantity }));
      l.problems = [];
      if (c.brokenCount > 0n) {
        // The broken units' photo is kept on their row (a-broken-product-carries-a-photo); a line with none has no row.
        l.problems.push({
          type: RestockProblemType.BROKEN,
          count: c.brokenCount,
          note: c.brokenNote,
          photoFile: c.brokenPhotoFile ?? "",
        });
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
    // The app's problem tags, in the same step (a-restock-problem-is-a-system-tag).
    putProblemTags(r.id, missing > 0n, broken > 0n);
    r.acceptedByUserId = SELF_ID;
    r.acceptedAtUnix = now();
    if (r.arrivedAtUnix === 0n) {
      r.arrivedAtUnix = r.acceptedAtUnix;
      r.arrivedByUserId = SELF_ID;
    }
    r.warehouseAdditionalCost = req.warehouseAdditionalCost;
    r.warehouseAdditionalCostNote = req.warehouseAdditionalCostNote;
    // The slip goes with the charge, or not at all (the-courier-slip-has-an-optional-photo) — as the server.
    r.warehouseAdditionalCostFile = req.warehouseAdditionalCost > 0 ? (req.warehouseAdditionalCostFile ?? "") : "";
    r.transactionId = 9000n + r.id;

    const parts = [`${broken} broken, ${missing} missing`];
    if (req.warehouseAdditionalCost > 0) parts.push(`courier's charge ${rupiah(req.warehouseAdditionalCost)}`);
    appendLog(r, from, S.ACCEPTED, `accepted — ${parts.join("; ")}`);

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestMarkLost(req) {
    const r = raisedBy(req.teamId, req.requestId);
    if (r.status !== S.ONGOING) throw precondition("only an ongoing restock can be marked lost");

    r.status = S.LOST;
    r.lostByUserId = SELF_ID;
    r.lostAtUnix = now();
    appendLog(r, S.ONGOING, S.LOST, req.description || "marked lost");

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestCancel(req) {
    const r = raisedBy(req.teamId, req.requestId);
    if (r.status !== S.ONGOING) throw precondition("restock request is not ongoing");

    r.status = S.CANCELLED;
    r.cancelledByUserId = SELF_ID;
    r.cancelledAtUnix = now();
    appendLog(r, S.ONGOING, S.CANCELLED, req.moneyReturned ? "cancelled — money returned" : "cancelled — money not returned");

    return { request: toWire(r, true, req.teamId) };
  },

  restockRequestLabels(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (r.status !== S.ACCEPTED) throw precondition("restock request is not accepted");

    return { restockId: r.id, ...labelSetOf(r) };
  },

  // CETAK LABEL'S ONE READ (the-labels-mark-their-one-by-one-read) — as the server: each slice keeps its one-restock read's
  // scope (RESTOCK_REQUEST is Detail's, LABELS is Labels': going to the warehouse, accepted); an id outside it, or
  // unknown, is absent. Every call's ids are recorded for the stories (restockReadScenario.byIdsCalls).
  restockRequestByIds(req) {
    const ids = req.filter?.ids ?? [];
    restockReadScenario.byIdsCalls.push([...ids]);
    const types = req.dataRequest.length > 0 ? req.dataRequest : [RestockRequestByIdsDataType.RESTOCK_REQUEST];
    const items: Record<string, { items: { d: { case: "restockRequest" | "labels"; value: unknown } }[] }> = {};
    const add = (id: bigint, d: { case: "restockRequest" | "labels"; value: unknown }) => {
      (items[id.toString()] ??= { items: [] }).items.push({ d });
    };

    for (const id of ids) {
      const r = rows.find((x) => x.id === id);
      if (!r) continue;

      const raisedOrComing = r.requestingTeamId === req.teamId || r.warehouseId === req.teamId;
      if (types.includes(RestockRequestByIdsDataType.RESTOCK_REQUEST) && raisedOrComing) {
        // As restock_request_by_ids.go builds it: the lines alone — no door rows at all (the labels read none).
        const row = toWire(r, false, req.teamId);
        add(id, { case: "restockRequest", value: { ...row, items: row.items.map((l) => ({ ...l, problems: [] })) } });
      }
      if (types.includes(RestockRequestByIdsDataType.LABELS) && r.warehouseId === req.teamId && r.status === S.ACCEPTED) {
        add(id, { case: "labels", value: labelSetOf(r) });
      }
    }

    return { items } as never;
  },

  // the-restocks-warehouse-opens-its-label-photo — the server's rules: the restock must be going to the calling warehouse
  // (another's reads NotFound, as an unknown id), and one with no photo is FailedPrecondition. The URL names the route
  // so a story can tell this link from the owner's GetDownloadUrl one.
  // THE DOOR'S PHOTOS (the-detail-pages-show-the-broken-photo, the-detail-pages-show-the-slip-and-the-broken-rack) — as the
  // server: either side of the restock (Detail's scope; another team reads NotFound), the slip and each photographed
  // broken line in product order, links that are drawings named by their document (doorPhotoScenario.ts). Every read is
  // recorded.
  restockDoorPhotos(req) {
    doorPhotoScenario.calls.push({ teamId: req.teamId, requestId: req.requestId });
    const r = visible(req.teamId, req.requestId);
    const broken = r.items
      .flatMap((l) =>
        l.problems
          .filter((p) => p.type === RestockProblemType.BROKEN && (p.photoFile ?? "") !== "")
          .map((p) => ({ productId: l.productId, url: brokenPhotoLink(p.photoFile!) })),
      )
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    const slip = r.warehouseAdditionalCostFile ?? "";
    const any = slip !== "" || broken.length > 0;

    return {
      courierSlipUrl: slip ? slipPhotoLink(slip) : "",
      broken,
      expiresAtUnix: any ? BigInt(Math.floor(Date.now() / 1000) + 900) : 0n,
    };
  },

  restockReceiptPhoto(req) {
    const r = comingTo(req.teamId, req.requestId);
    if (!r.receiptFile) throw precondition("this restock has no label photo");

    return {
      url: `https://example.invalid/restock-photo/${r.receiptFile}`,
      expiresAtUnix: BigInt(Math.floor(Date.now() / 1000) + 900),
    };
  },

  // THE COD THE WAREHOUSE PAID (the-warehouse-sees-the-cod-it-paid) — as the server: restocks going to it, accepted in the
  // window (both ends in), that carried a courier's charge; the charges summed. Every window asked is recorded.
  restockCodPaidStat(req) {
    restockReadScenario.codWindows.push({ teamId: req.teamId, fromUnix: req.fromUnix, toUnix: req.toUnix });
    const paid = rows.filter(
      (r) =>
        r.warehouseId === req.teamId &&
        r.status === S.ACCEPTED &&
        r.acceptedAtUnix >= req.fromUnix &&
        r.acceptedAtUnix <= req.toUnix &&
        r.warehouseAdditionalCost > 0,
    );

    return {
      restockCount: BigInt(paid.length),
      amount: paid.reduce((sum, r) => sum + r.warehouseAdditionalCost, 0),
    };
  },

  // THE SELLING RESTOCK LIST AS A FILE (restock_request_export.go): the list's own predicate, the tab included, the
  // restocks the team RAISED, newest first — a count, then (once a story's hold is released) the link. The link is an
  // empty data: URL, so the download a story triggers goes nowhere. What was asked is recorded.
  restockRequestExport: async function* (req) {
    const raised = rows
      .filter((r) => r.requestingTeamId === req.teamId && inListScope(r, req.teamId, req.filter))
      .sort((a, b) => (a.id > b.id ? -1 : 1));
    const total = BigInt(raised.length);

    restockExportScenario.calls.push({ teamId: req.teamId, filter: req.filter, rows: raised.length });

    yield { message: "exporting restocks", done: 0n, total };
    if (restockExportScenario.hold) await restockExportScenario.hold;
    yield {
      message: "the file is ready",
      done: total,
      total,
      downloadUrl: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,",
      filename: "restok.xlsx",
    };
  },

  // THE SELLING RESTOCK LIST'S STATISTICS (restock_selling_stat.go): the list's own predicate with its status cleared, the
  // restocks the team RAISED only — a pile per status that has any, the total over every status (its products counted
  // together), and a row per status × paying account (0 included). Every filter asked is recorded.
  restockSellingStat(req) {
    restockReadScenario.sellingStatCalls.push({ teamId: req.teamId, filter: req.filter });
    const filter = req.filter ? { ...req.filter, status: S.UNSPECIFIED } : undefined;
    const raised = rows.filter((r) => r.requestingTeamId === req.teamId && inListScope(r, req.teamId, filter));
    const statuses = [S.ONGOING, S.ARRIVED, S.ACCEPTED, S.LOST, S.CANCELLED];

    const byAccount = [];
    for (const status of statuses) {
      const accounts = new Map<string, RestockFixture[]>();
      for (const r of raised.filter((x) => x.status === status)) {
        const key = r.financeAccountId.toString();
        accounts.set(key, [...(accounts.get(key) ?? []), r]);
      }
      for (const [id, paid] of accounts) {
        byAccount.push({
          status,
          financeAccountId: BigInt(id),
          restockCount: BigInt(paid.length),
          value: pileOfRestocks(status, paid).value,
        });
      }
    }

    return {
      total: pileOfRestocks(S.UNSPECIFIED, raised),
      byStatus: statuses
        .map((status) => pileOfRestocks(status, raised.filter((r) => r.status === status)))
        .filter((p) => p.restockCount > 0n),
      byAccount,
    };
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
        amount: lines.reduce((s, l) => s + l.total, 0),
        oldestPendingUnix: waiting.reduce((min, r) => (min === 0n || r.createdAtUnix < min ? r.createdAtUnix : min), 0n),
      },
    };
  },
};
