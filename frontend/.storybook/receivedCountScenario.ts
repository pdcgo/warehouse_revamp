// KOREKSI JUMLAH TERIMA in Storybook — what the server keeps for a received-count correction, shared by the three stubs
// that read it: restockStub.ts and warehouseTransferStub.ts (the two writes, the detail's fields) and batchStub.ts (the
// batch's history row and its Hilang). docs/business/inventory/adjustment_decision.md:
// the-warehouse-corrects-a-wrong-stock-in-alone, a-stock-in-correction-keeps-the-batch-price,
// a-wrong-stock-in-is-a-received-count-correction, the-received-count-prototype-is-accepted.
//
// THE BATCHES EACH ACCEPTED LINE BECAME, in its receiving warehouse — what the detail's `correction_facts` serve, matching
// the other stubs' rows where they meet (batchStub's 5031 / 5032 / 5071):
//
//   restock 503 → Gudang Pusat (11), Toko Melati's (12)
//     5031 Beras    ordered 10 · received 9 (2 broken, 1 missing) → batch 5031, 7 left: A-01-1 ×5, B-02-1 ×2
//     5032 Teh      ordered 20 · received 20                      → batch 5032, 17 left: A-01-2 ×17
//   restock 507 → Gudang Pusat
//     5071 Teh      ordered 15 · received 15                      → batch 5071, all sold: 0 left
//   transfer 605 Gudang Pusat (A) → Gudang Cabang (14, B), Toko Melati's
//     6051 Beras    sent 6 · arrived 5 (1 broken, 1 missing)      → batch 6151, 4 left: C-01-1 ×4
//     6052 Teh      sent 10 · arrived 10                          → batch 6152, 7 left: C-01-1 ×4, C-01-2 ×3
//
// The racks are the PRODUCT's units on each rack here, as the server serves them (a rack counts the product, never a
// batch). Every correction moves them, and the batch's holding, as the server's posting does.
//
// ⚠ ITS OWN MODULE (as sessionScenario.ts): a story imports the seed helper below, and importing stubTransport.ts would
// pull the whole stub into `npm run typecheck`.

import { Code, ConnectError } from "@connectrpc/connect";

import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { racks } from "./fixtures";
import { sessionScenario } from "./sessionScenario";
import { SELF_ID } from "./userStub";

export type CorrectionSubject = "restock" | "transfer";

export interface StubShelf {
  rackId: bigint;
  units: bigint;
}

interface LineFacts {
  batchId: bigint;
  holds: bigint;
  shelves: StubShelf[];
}

const BASE: Record<string, LineFacts> = {
  "restock:5031": { batchId: 5031n, holds: 7n, shelves: [{ rackId: 41n, units: 5n }, { rackId: 43n, units: 2n }] },
  "restock:5032": { batchId: 5032n, holds: 17n, shelves: [{ rackId: 42n, units: 17n }] },
  "restock:5071": { batchId: 5071n, holds: 0n, shelves: [] },
  "transfer:6051": { batchId: 6151n, holds: 4n, shelves: [{ rackId: 44n, units: 4n }] },
  "transfer:6052": { batchId: 6152n, holds: 7n, shelves: [{ rackId: 44n, units: 4n }, { rackId: 45n, units: 3n }] },
};

/** One line's correction, as the server keeps it (restock_count_corrections / warehouse_transfer_count_corrections). */
export interface StubCorrection {
  id: bigint;
  subject: CorrectionSubject;
  targetId: bigint;
  itemId: bigint;
  productId: bigint;
  fromCount: bigint;
  toCount: bigint;
  /** from − to: > 0 left the batch (too many were typed), < 0 went into it. */
  unitsOut: bigint;
  batchId: bigint;
  placementId: bigint;
  reason: string;
  actorUserId: bigint;
  isOverride: boolean;
  atUnix: bigint;
  transactionId: bigint;
  /** The batch's price — read by the OWNING team only (a-warehouse-sees-no-seller-money). */
  priceUnit: number;
  total: number;
}

let corrections: StubCorrection[] = [];

/** Called from the restock stub's reset (preview's `beforeEach`), so every story starts with no correction. */
export function resetReceivedCountScenario() {
  corrections = [];
}

const keyOf = (subject: CorrectionSubject, itemId: bigint) => `${subject}:${itemId}`;

/** A line's batch as it stands now — its holding and racks after the corrections already made. `undefined` = none known. */
export function lineFacts(subject: CorrectionSubject, itemId: bigint): LineFacts | undefined {
  const base = BASE[keyOf(subject, itemId)];
  if (!base) return undefined;

  const shelves = base.shelves.map((s) => ({ ...s }));
  let holds = base.holds;

  for (const c of corrections.filter((x) => x.subject === subject && x.itemId === itemId)) {
    holds -= c.unitsOut;
    const shelf = shelves.find((s) => s.rackId === c.placementId);
    if (shelf) shelf.units -= c.unitsOut;
    else shelves.push({ rackId: c.placementId, units: -c.unitsOut });
  }

  return { batchId: base.batchId, holds, shelves: shelves.filter((s) => s.units > 0n) };
}

/** A restock's / transfer's corrections, oldest first. */
export function correctionsOf(subject: CorrectionSubject, targetId: bigint): StubCorrection[] {
  return corrections.filter((c) => c.subject === subject && c.targetId === targetId);
}

/** A batch's corrections, oldest first — its history rows and its Hilang (batchStub.ts). */
export function correctionsOfBatch(batchId: bigint): StubCorrection[] {
  return corrections.filter((c) => c.batchId === batchId);
}

/** Records one correction act's lines — one transaction, one row per line. The stubs judge the rules first. */
export function recordCorrections(lines: Omit<StubCorrection, "id" | "transactionId" | "atUnix">[]): StubCorrection[] {
  const at = BigInt(Math.floor(Date.now() / 1000));
  const transactionId = 97_000n + BigInt(corrections.length);
  const made = lines.map((l, i) => ({ ...l, id: 900_001n + BigInt(corrections.length + i), transactionId, atUnix: at }));
  corrections = [...corrections, ...made];

  return made;
}

// ── THE WRITE, AS THE SERVER JUDGES IT (received_count_shared.go, post_received_count.go) ───────────────────────────────

/** One line of the restock / transfer as the write judges it. */
export interface JudgedLine {
  itemId: bigint;
  productId: bigint;
  productCode: string;
  /** The received (arrived) count as it stands — the accept's, or the last correction's. */
  received: bigint;
  broken: bigint;
  /** Ordered (a restock) or sent (a transfer). */
  ceiling: bigint;
  /** The batch's price, for the owning team's money. */
  priceUnit: number;
}

export interface CorrectionRequest {
  reason: string;
  lines: { itemId: bigint; expectedReceivedCount: bigint; receivedCount: bigint; placementId: bigint }[];
}

const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);
const precondition = (msg: string) => new ConnectError(msg, Code.FailedPrecondition);

/**
 * KOREKSI JUMLAH TERIMA's rules in the server's order, then the posting — for RestockReceivedCountCorrect and
 * WarehouseTransferReceivedCountCorrect. The caller found the restock / transfer by id AND receiving warehouse (another's
 * reads NotFound) and checked it is accepted. Throws the server's refusal, writes nothing then.
 *
 *   who          Root, the Administrator, the warehouse's Owner or Admin — Staff PermissionDenied (the policy)
 *   reason       required, at most 200, trimmed                                   InvalidArgument
 *   lines        each at most once, of this restock / transfer                    InvalidArgument
 *   stale        the count the form showed is no longer the line's                FailedPrecondition
 *   the count    a change; not below the broken; not above ordered / sent         InvalidArgument
 *   the rack     this warehouse's                                                 NotFound
 *   units out    not more than the batch, nor the rack, still holds               FailedPrecondition
 *
 * Root or the Administrator are stamped an override (an-override-is-stamped-in-every-service).
 */
export function postCorrection(
  subject: CorrectionSubject,
  targetId: bigint,
  warehouseId: bigint,
  req: CorrectionRequest,
  lineOf: (itemId: bigint) => JudgedLine | undefined,
  ceilingWord: "ordered" | "sent",
): StubCorrection[] {
  const role = sessionScenario.role;
  const override = role === Role.ROOT || role === Role.ADMINISTRATOR;
  if (!override && role !== Role.WAREHOUSE_OWNER && role !== Role.WAREHOUSE_ADMIN) {
    throw new ConnectError("permission denied", Code.PermissionDenied);
  }

  const reason = req.reason.trim();
  if (reason === "") throw invalid("a received-count correction needs a reason");
  if ([...reason].length > 200) throw invalid("the reason is at most 200 characters");
  if (req.lines.length === 0) throw invalid("lines: value must contain at least 1 item(s)");
  if (new Set(req.lines.map((l) => l.itemId.toString())).size !== req.lines.length) {
    throw invalid("lines: a line is corrected at most once per correction");
  }

  for (const l of req.lines) {
    const line = lineOf(l.itemId);
    if (!line) throw invalid("lines: not a line of this restock or transfer");

    if (l.expectedReceivedCount !== line.received) {
      throw precondition(
        `the line's received count changed since the form opened: ${line.productCode} now reads ${line.received} received, not ${l.expectedReceivedCount} — someone corrected it first; reload and correct again`,
      );
    }
    if (l.receivedCount === line.received) {
      throw invalid(`nothing to correct: ${line.productCode} already reads ${line.received} received`);
    }
    if (l.receivedCount < line.broken) {
      throw invalid(
        `the real count is below the broken units: ${line.productCode} has ${line.broken} broken in the box — the real count is at least ${line.broken}`,
      );
    }
    if (l.receivedCount > line.ceiling) {
      throw invalid(
        `the real count is above what the line says: ${line.productCode} — ${line.ceiling} ${ceilingWord}; a unit over the line is found stock: Adjust › Found`,
      );
    }
  }

  for (const l of req.lines) {
    if (!racks.some((r) => r.id === l.placementId && r.warehouseId === warehouseId)) {
      throw new ConnectError("rack not found", Code.NotFound);
    }
  }

  for (const l of req.lines) {
    const line = lineOf(l.itemId)!;
    const out = line.received - l.receivedCount;
    if (out <= 0n) continue;

    const facts = lineFacts(subject, l.itemId);
    if (!facts || facts.batchId === 0n) {
      throw precondition("the line has no batch here (it holds 0) — a correction takes out only the units still there");
    }
    if (out > facts.holds) {
      throw precondition(`batch #${facts.batchId} holds only ${facts.holds} — a correction takes out only the units still there`);
    }
    const onRack = facts.shelves.find((s) => s.rackId === l.placementId)?.units ?? 0n;
    if (out > onRack) {
      throw precondition(
        `rack #${l.placementId} holds only ${onRack} of this product — take the units off a rack that holds them`,
      );
    }
  }

  return recordCorrections(
    req.lines.map((l) => {
      const line = lineOf(l.itemId)!;
      const out = line.received - l.receivedCount;

      return {
        subject,
        targetId,
        itemId: l.itemId,
        productId: line.productId,
        fromCount: line.received,
        toCount: l.receivedCount,
        unitsOut: out,
        batchId: lineFacts(subject, l.itemId)?.batchId ?? 0n,
        placementId: l.placementId,
        reason,
        actorUserId: SELF_ID,
        isOverride: override,
        priceUnit: line.priceUnit,
        total: line.priceUnit * Number(out),
      };
    }),
  );
}

/** What the detail serves of a line's corrections, as `reader` reads it — the money for the owning team only. */
export function correctionFieldsOf(
  subject: CorrectionSubject,
  targetId: bigint,
  itemId: bigint,
  withMoney: boolean,
  withFacts: boolean,
) {
  const own = correctionsOf(subject, targetId).filter((c) => c.itemId === itemId);
  const facts = withFacts ? lineFacts(subject, itemId) : undefined;

  return {
    correctedFrom: own[0]?.fromCount,
    missingByCorrection: own.reduce((s, c) => s + c.unitsOut, 0n),
    missingByCorrectionTotal: withMoney && own.length > 0 ? own.reduce((s, c) => s + c.total, 0) : undefined,
    correctionFacts: facts
      ? {
          batchId: facts.batchId,
          batchHolds: facts.holds,
          shelves: facts.shelves.map((sh) => ({ placementId: sh.rackId, units: sh.units })),
        }
      : undefined,
  };
}

/** The restock's / transfer's history rows on the wire — `price_unit` / `total` unset for a warehouse. */
export function correctionRowsOf(subject: CorrectionSubject, targetId: bigint, withMoney: boolean) {
  return correctionsOf(subject, targetId).map((c) => ({
    id: c.id,
    itemId: c.itemId,
    productId: c.productId,
    fromCount: c.fromCount,
    toCount: c.toCount,
    unitsOut: c.unitsOut,
    batchId: c.batchId,
    placementId: c.placementId,
    reason: c.reason,
    actorUserId: c.actorUserId,
    isOverride: c.isOverride,
    atUnix: c.atUnix,
    transactionId: c.transactionId,
    priceUnit: withMoney ? c.priceUnit : undefined,
    total: withMoney ? c.total : undefined,
  }));
}
