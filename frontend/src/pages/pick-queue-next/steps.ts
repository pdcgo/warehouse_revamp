import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE WAREHOUSE'S STEPS AND WHERE EACH MAY GO — the warehouse's side of the status diagram
// (the-status-move-is-the-only-journey), the moves OrderStatusChange lets a warehouse make
// (one-status-change-for-every-plain-move). Each step IS an order status now:
//
//   Perlu konfirmasi (pending)    → Dikonfirmasi
//   Dikonfirmasi (processed)      → Sudah diambil · back to Perlu konfirmasi
//   Sudah diambil (picked)        → Sudah diserahkan · back to Perlu konfirmasi
//   Sudah diserahkan (shipping)   → (none — the parcel is customer service's from here)
//
// Going BACK is only ever to Perlu konfirmasi — goods on no rack, or the platform cancelled and the parcel
// was unpacked — and asks for a reason, which the server requires and keeps on the order's history. Stock
// does not move on any of these: the goods left the shelf's count when the order was placed.
//
// 🔄 IT REPLACES THE OLD SYSTEM'S TABLE (`a-warehouse-step-moves-by-the-old-systems-table`), which the
// owner's later status diagram supersedes: "Sedang diambil" folded into processed and "Dikemas" into
// picked (00015), so the skips between them went with them, and a move back now returns to pending.
//
// ⚠ THE TABLE IS THE SERVER'S (`orderMoves`, order_transition.go). This copy only decides what the menu
// offers; a move the server refuses comes back with its reason.

export type WarehouseStep = "toConfirm" | "confirm" | "picked" | "handover";

export const STEP_MOVES: Record<WarehouseStep, WarehouseStep[]> = {
  toConfirm: ["confirm"],
  confirm: ["picked", "toConfirm"],
  picked: ["handover", "toConfirm"],
  handover: [],
};

const STEP_STATUS: Record<WarehouseStep, OrderStatus> = {
  toConfirm: OrderStatus.PENDING,
  confirm: OrderStatus.PROCESSED,
  picked: OrderStatus.PICKED,
  handover: OrderStatus.SHIPPING,
};

const STEPS = Object.keys(STEP_STATUS) as WarehouseStep[];

/** The status a step is. */
export function statusOfStep(step: WarehouseStep): OrderStatus {
  return STEP_STATUS[step];
}

/** The step an order is at, from its status — undefined once the warehouse is done with it. */
export function stepOfStatus(status: OrderStatus): WarehouseStep | undefined {
  return STEPS.find((step) => STEP_STATUS[step] === status);
}

/** Whether a move sends the order back to the queue — the one that asks for a reason. */
export function isBack(from: WarehouseStep, to: WarehouseStep): boolean {
  return to === "toConfirm" && from !== "toConfirm";
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
