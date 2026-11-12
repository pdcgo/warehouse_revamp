import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { personName } from "../../lib/users";
import { canWrite, type CurrentTeam } from "../team/TeamContext";
import { fetchActors } from "../users/queries";
import type { PriceChange } from "./MovementTable";

// KOREKSI HARGA's shared rules on the screen side (the-owning-team-revalues-with-a-reason,
// the-correct-price-prototype-is-accepted): who gets the button, and how a history row that is a price correction reads.
// The server (InventoryService.BatchRevalue, inventory_v1/batch_revalue.go) is the boundary; this is what a screen shows.

/**
 * WHO MAY CORRECT A BATCH'S PRICE: the Owner or Admin of the team that owns the batch — plus Root and the System
 * Administrator, as everywhere. Never the warehouse holding it, never a CS, never a monitor. The owning team reaches its
 * batches on its product's page, where the current team IS the owner; on a warehouse's batch page only Root and the
 * Administrator pass. ⚠ UX only — the server's policy is the boundary.
 */
export function canCorrectPrice(current: CurrentTeam | null | undefined): boolean {
  if (!current || !canWrite(current)) return false;

  switch (current.role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.SELLING_OWNER:
    case Role.SELLING_ADMIN:
      return true;

    default:
      return false;
  }
}

/** What a history row carries that a price correction reads from — StockMovement and OwnerMovement both have it. */
export interface PricedRow {
  kind: MovementKind;
  priceUnitBefore: number;
  priceUnitAfter: number;
  valueChange: number;
  reason: string;
  actorUserId: bigint;
  isOverride: boolean;
}

/**
 * The PRICE CORRECTION a history row stands for — `undefined` for every other row. Its price from and to, the units
 * left's value change, the reason, who (named from `actors`, `#id` when the lookup failed) and the Root stamp.
 */
export function priceChangeOf(row: PricedRow, actors: Map<string, PublicUser>): PriceChange | undefined {
  if (row.kind !== MovementKind.REVALUATION) return undefined;

  const id = row.actorUserId.toString();

  return {
    from: row.priceUnitBefore,
    to: row.priceUnitAfter,
    valueDelta: row.valueChange,
    reason: row.reason,
    actorName: personName(actors.get(id), `#${id}`),
    isOverride: row.isOverride,
  };
}

/**
 * A page of history rows with each price correction's `priceChange` — its actors named with ONE UserByIDs, only when the
 * page holds a correction (a page without one makes no extra call). Never throws: an unnamed actor reads `#id`.
 */
export async function withPriceChanges<R extends PricedRow>(rows: R[]): Promise<(R & { priceChange?: PriceChange })[]> {
  const corrections = rows.filter((r) => r.kind === MovementKind.REVALUATION);
  if (corrections.length === 0) return rows;

  const actors = await fetchActors(corrections.map((r) => r.actorUserId));

  return rows.map((r) => {
    const priceChange = priceChangeOf(r, actors);
    return priceChange ? { ...r, priceChange } : r;
  });
}
