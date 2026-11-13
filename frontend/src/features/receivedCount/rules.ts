import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { canWrite, type CurrentTeam } from "../team/TeamContext";

// KOREKSI JUMLAH TERIMA — the screen side of a wrong stock-in's correction (the-warehouse-corrects-a-wrong-stock-in-alone,
// a-stock-in-correction-keeps-the-batch-price, a-wrong-stock-in-is-a-received-count-correction,
// the-received-count-prototype-is-accepted). The server (RestockReceivedCountCorrect,
// WarehouseTransferReceivedCountCorrect) is the boundary for every rule below; this is what the form says before it asks.

/**
 * WHO MAY CORRECT: the RECEIVING warehouse's Owner or Admin — the side that counted the box (any-warehouse-member-counts-
 * what-arrived) — plus Root and the System Administrator, stamped *by Root team* (the-override-badge-is-accepted-as-by-
 * root-team). Never its Staff, never the selling team, never the sending warehouse, never a monitor.
 */
export function canCorrectReceivedCount(current: CurrentTeam | null | undefined, receivingWarehouseId: bigint): boolean {
  if (!current || !canWrite(current)) return false;
  if (current.teamId !== receivingWarehouseId) return false;

  switch (current.role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
      return true;

    default:
      return false;
  }
}

/**
 * A rack holding the line's product in the receiving warehouse, and how many units (the read's ReceivedCountShelf) — a
 * rack counts the product, never a batch (a-batch-shows-the-racks-it-was-put-on), so these are the product's units.
 */
export interface BatchShelf {
  rackId: bigint;
  units: bigint;
}

/** One line of the restock or transfer, as the form corrects it. Units only: no price (a-warehouse-sees-no-seller-money). */
export interface CountLine {
  lineId: bigint;
  productId: bigint;
  name: string;
  productCode: string;
  /** What the line says — ordered (a restock) or sent (a transfer). The count is never above it. */
  ceiling: bigint;
  /** The received count as it stands — the accept's, or the last correction's. */
  received: bigint;
  /** Broken at the door — counted inside `received`, so the real count never goes below it. */
  broken: bigint;
  /** The batch the good units became (0 = none yet), and how many of them it still holds in this warehouse. */
  batchId: bigint;
  batchHolds: bigint;
  shelves: BatchShelf[];
}

/** What the person typed for one line. `real` "" = untouched; racks as RackSelect strings ("" = not picked). */
export interface LineDraft {
  real: string;
  fromRack: string;
  toRack: string;
}

export type LineRefusal =
  | { kind: "none" }
  | { kind: "belowBroken"; broken: bigint }
  | { kind: "overCeiling"; ceiling: bigint }
  | { kind: "overBatch"; batchId: bigint; holds: bigint }
  | { kind: "noRack" }
  | { kind: "overRack"; rackId: bigint; holds: bigint };

export interface LineEffect {
  real: bigint;
  /** Units leaving the batch (> 0, too many were typed) or going into it (< 0, too few were typed). 0 = unchanged. */
  out: bigint;
  refusal: LineRefusal;
}

/**
 * ONE LINE'S RULES, in the order the server would refuse them:
 *
 *   below the broken units   0 ≤ broken ≤ received (any-warehouse-member-counts-what-arrived)
 *   above the line           a restock's ordered count (accept-refuses-more-than-the-line-says); a transfer's sent count —
 *                            good + broken + missing is what the out-leg sent (PostTransferIn)
 *   out of the batch         only the units still there (a-stock-in-correction-keeps-the-batch-price: *"refused — taking
 *                            out more units than the batch still holds"*, a-rollback-only-undoes-a-take)
 *   the rack                 units out come off a rack holding the product here, never below what it holds
 *                            (a-shelf-never-goes-below-zero); units in go onto a rack (there-is-no-unplaced-pile)
 *
 * The rack and the batch are judged again under the server's locks — what changed since the form opened comes back as
 * the server's refusal.
 */
export function lineEffect(line: CountLine, draft: LineDraft): LineEffect {
  const real = draft.real === "" ? line.received : BigInt(draft.real);
  const out = line.received - real;

  if (out === 0n) return { real, out, refusal: { kind: "none" } };
  if (real < line.broken) return { real, out, refusal: { kind: "belowBroken", broken: line.broken } };
  if (real > line.ceiling) return { real, out, refusal: { kind: "overCeiling", ceiling: line.ceiling } };

  if (out > 0n) {
    if (out > line.batchHolds) return { real, out, refusal: { kind: "overBatch", batchId: line.batchId, holds: line.batchHolds } };

    const shelf = line.shelves.find((s) => s.rackId.toString() === draft.fromRack);
    if (!shelf) return { real, out, refusal: { kind: "noRack" } };
    if (out > shelf.units) return { real, out, refusal: { kind: "overRack", rackId: shelf.rackId, holds: shelf.units } };

    return { real, out, refusal: { kind: "none" } };
  }

  if (draft.toRack === "") return { real, out, refusal: { kind: "noRack" } };

  return { real, out, refusal: { kind: "none" } };
}

/** The rack a line's units come off by default — the one holding the most of the product. */
export function defaultFromRack(line: CountLine): string {
  const best = [...line.shelves].sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0))[0];

  return best ? best.rackId.toString() : "";
}
