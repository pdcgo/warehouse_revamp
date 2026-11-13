import type { ReceivedCountCorrection } from "../../gen/warehouse/inventory/v1/received_count_pb";
import type { MovementCountCorrection } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { personName } from "../../lib/users";
import type { CountCorrection } from "../inventory/MovementTable";

// KOREKSI JUMLAH TERIMA ON THE READ SIDE (the-received-count-prototype-is-accepted — the result): what the restock and
// transfer details and the stock histories serve, said the way the accepted design draws it. The server is the
// boundary for every figure here; nothing below works one out that the read does not carry.
//
//   a line            corrected_from (the accept's count, once corrected), missing_by_correction (net units out), and
//                     missing_by_correction_total — the selling team's money, unset for a warehouse
//                     (a-warehouse-sees-no-seller-money)
//   the restock /     count_corrections — one history row per line per correction, oldest first, beside the trail:
//   transfer          its own kind, never a status row (a correction must not read as the selling team's edit)
//   a history row     an ADJUST carrying received_count_correction — from → to and the reason

/** The line fields a correction fills — RestockRequestItem and WarehouseTransferItem both carry them. */
export interface CorrectedLine {
  id: bigint;
  correctedFrom?: bigint;
  missingByCorrection: bigint;
  missingByCorrectionTotal?: number;
}

/** What a corrected line reads — `undefined` for a line nobody corrected. */
export interface LineCorrectionView {
  /** The count the accept wrote, before any correction — *dikoreksi dari 20*. */
  was: bigint;
  /** Units out of the batch net (> 0 too many were typed, < 0 too few) — the *(koreksi)* part of Kurang. */
  netOut: bigint;
  /** What those units are worth at the batch price — the OWNING team only; `undefined` for a warehouse. */
  value?: number;
  /** The line's newest correction — why, and who. */
  last?: ReceivedCountCorrection;
}

export function lineCorrection(line: CorrectedLine, corrections: ReceivedCountCorrection[]): LineCorrectionView | undefined {
  if (line.correctedFrom === undefined) return undefined;

  const own = corrections.filter((c) => c.itemId === line.id);

  return {
    was: line.correctedFrom,
    netOut: line.missingByCorrection,
    value: line.missingByCorrectionTotal,
    last: own[own.length - 1],
  };
}

/** One step of a trail: a status row (or an edit) as the server logged it, or a received-count correction. */
export type TrailStep<L> = { kind: "log"; log: L } | { kind: "correction"; correction: ReceivedCountCorrection };

/**
 * THE TRAIL WITH ITS CORRECTIONS, oldest first — each correction after every logged step at or before its time. Both
 * lists come oldest first from the server; the merge keeps each list's own order.
 */
export function trailOf<L extends { atUnix: bigint }>(logs: L[], corrections: ReceivedCountCorrection[]): TrailStep<L>[] {
  const out: TrailStep<L>[] = [];
  let next = 0;

  for (const log of logs) {
    while (next < corrections.length && corrections[next]!.atUnix < log.atUnix) {
      out.push({ kind: "correction", correction: corrections[next]! });
      next++;
    }
    out.push({ kind: "log", log });
  }

  for (; next < corrections.length; next++) {
    out.push({ kind: "correction", correction: corrections[next]! });
  }

  return out;
}

/** What a history row carries that a received-count correction reads from — StockMovement and OwnerMovement both. */
export interface CountedRow {
  actorUserId: bigint;
  isOverride: boolean;
  receivedCountCorrection?: MovementCountCorrection;
}

/**
 * THE RECEIVED-COUNT CORRECTION a history row stands for — `undefined` for every other row: *Jumlah terima dikoreksi ·
 * from → to*, the reason, who (named from `actors`, `#id` when the lookup failed) and the Root stamp — from the row's own
 * actor and override, as a price correction reads them.
 */
export function countCorrectionOf(row: CountedRow, actors: Map<string, PublicUser>): CountCorrection | undefined {
  const c = row.receivedCountCorrection;
  if (!c) return undefined;

  const id = row.actorUserId.toString();

  return {
    from: c.fromCount,
    to: c.toCount,
    reason: c.reason,
    actorName: personName(actors.get(id), `#${id}`),
    isOverride: row.isOverride,
  };
}
