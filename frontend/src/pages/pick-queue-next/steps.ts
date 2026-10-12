import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import type { FulfilmentStep } from "../../features/picking/queries";

// THE WAREHOUSE'S STEPS AND WHERE EACH MAY GO (owner — `a-warehouse-step-moves-by-the-old-systems-table`).
//
//   Perlu konfirmasi → Dikonfirmasi
//   Dikonfirmasi     → Sedang diambil · Sudah diambil · Dikemas
//   Sedang diambil   → Sudah diambil · Dikonfirmasi · Dikemas
//   Sudah diambil    → Dikemas · Dikonfirmasi
//   Dikemas          → Sudah diserahkan · Dikonfirmasi
//   Sudah diserahkan → (none)
//
// Skipping forward is allowed (a small order picked and packed in one go); going BACK is only ever to
// Dikonfirmasi — the order returns to the queue — and asks for a reason. Stock does not move on any of
// these: the goods left the shelf's count when the order was placed.
//
// ⚠ THE TABLE BELONGS ON THE SERVER. This is the preview's copy, so the menu offers only allowed moves;
// the RPCs today move ONE step forward each (confirm, pick, pack, ship), so a skip, a move back, or a move
// into "Sudah diambil" (no status yet) does nothing but say so — the `stepMove` mark.

export type WarehouseStep = "toConfirm" | "confirm" | "picking" | "picked" | "packed" | "handover";

export const STEP_MOVES: Record<WarehouseStep, WarehouseStep[]> = {
  toConfirm: ["confirm"],
  confirm: ["picking", "picked", "packed"],
  picking: ["picked", "confirm", "packed"],
  picked: ["packed", "confirm"],
  packed: ["handover", "confirm"],
  handover: [],
};

/** The step an order is at, from its status. Handed over is SHIPPED in the build until it has its own. */
export function stepOfStatus(status: OrderStatus): WarehouseStep | undefined {
  switch (status) {
    case OrderStatus.PLACED:
      return "toConfirm";
    case OrderStatus.CONFIRMED:
      return "confirm";
    case OrderStatus.PICKING:
      return "picking";
    case OrderStatus.PACKED:
      return "packed";
    case OrderStatus.SHIPPED:
      return "handover";
    default:
      return undefined;
  }
}

/** Whether a move sends the order back to the queue — the one that asks for a reason. */
export function isBack(from: WarehouseStep, to: WarehouseStep): boolean {
  return to === "confirm" && from !== "toConfirm";
}

/** The RPC that makes this move today, or undefined when none does (a skip, a move back, "picked"). */
export function rpcFor(from: WarehouseStep, to: WarehouseStep): FulfilmentStep | undefined {
  if (from === "toConfirm" && to === "confirm") return "confirm";
  if (from === "confirm" && to === "picking") return "pick";
  if (from === "picking" && to === "packed") return "pack";
  if (from === "packed" && to === "handover") return "ship";
  return undefined;
}

/** The i18n key that names a step — the tab's own word. */
export function stepLabelKey(step: WarehouseStep): string {
  return step === "toConfirm" ? "warehouseOrders.tab.toConfirm" : `orders.step.${step}`;
}

/** The moves every one of these orders allows — what a bulk change may offer. */
export function commonMoves(statuses: OrderStatus[]): WarehouseStep[] {
  const sets = statuses.map((status) => {
    const step = stepOfStatus(status);
    return new Set(step ? STEP_MOVES[step] : []);
  });

  if (sets.length === 0) return [];

  return [...sets[0]!].filter((target) => sets.every((set) => set.has(target)));
}
