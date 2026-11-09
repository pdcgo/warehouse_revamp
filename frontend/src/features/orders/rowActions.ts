import { Ban, CircleAlert, CircleCheck, Gavel, PackageX, Pencil, Truck, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import type { OrderStageId } from "./stages";

// WHAT YOU CAN DO TO AN ORDER, BY THE STATUS IT IS IN (owner) — the whole table in one place, so the
// kebab is a rendering of a rule rather than a pile of conditions.
//
// The owner gave it in the OLD system's status names, and it lands on the eleven like this:
//
//   created           → pending            Batalkan Order, Edit Resi
//   process           → processed, picked  Edit Resi
//   shipped           → shipping           Jadikan Dikirim, Retur Barang — handed over, not yet moving
//   courrier_shipped  → shipped            Retur Barang, Selesaikan Order — moving; + Tandai Bermasalah (#11),
//                                          + Jadikan Lost (every-allowed-move-has-a-button)
//   return            → return             Jadikan Lost
//   completed         → completed          Retur Barang (every-allowed-move-has-a-button)
//   problem           → problem            Selesaikan Sengketa; + Retur Barang, Jadikan Lost (#11)
//
// #11 — THE MOVES THE SERVER ALLOWED WITH NO BUTTON. §Status Move (the-status-move-is-the-only-journey) draws
// `shipped → problem`, `problem → return` and `problem → lost`, and orderMoves serves them, but the menu offered none:
//   - Tandai Bermasalah on `shipped` — customer service sets `problem` by hand from the platform
//     (customer-service-sets-shipped-and-problem-by-hand, whose ⚠ says the menu had "no way into problem").
//   - Retur Barang on `problem` — CS claims it back, or the warehouse forces it (a-forced-return-follows-the-status-move
//     lists `problem` among the four statuses a return may leave); the same action as on `shipping` and `shipped`.
//   - Jadikan Lost on `problem` — customer service writes the parcel off. Confirms, as on `return`.
//
// EVERY ALLOWED MOVE HAS A BUTTON (every-allowed-move-has-a-button, owner 2026-11-04) — the last two edges of orderMoves
// with none:
//   - Jadikan Lost on `shipped` — the courier lost it before delivery, without passing through `problem`. Confirms.
//   - Retur Barang on `completed` — the buyer sends a delivered order back. Confirms; `either`, like every return, so the
//     warehouse's list offers it too (a-forced-return-follows-the-status-move lists `completed`).
//
// ⚠ THREE ROWS ARE NOT THE OWNER'S WORDS VERBATIM, and each is a decision:
//   - `shipping` has no Selesaikan Order: the status diagram has no `shipping → completed`, so it waits
//     for `shipped` (the-order-menu-and-the-status-move-disagree-after-the-handover, third row).
//   - `return` has no Selesaikan Order: it needed the withdrawal figure settlement does not have
//     (finish-order-on-a-return-waits-for-the-withdrawal).
//   - `completed` has no Edit Withdrawal: nobody types a withdrawal figure onto an order — settlement's
//     payout row is the record (no-withdrawal-is-typed-on-an-order).
//
// Every move goes through OrderStatusChange (one-status-change-for-every-plain-move), whose table says
// which END may make it — and the server refuses the other. So an action here carries its END too, and
// the menu offers it only to the end that may press it: a refusal is a question the reader should never
// have been asked.
//
// ⚠ NOTHING IS GREYED OUT. An action an order cannot take is ABSENT — a disabled item is a question a
// reader has to answer ("why not?"), an absent one is not asked.

export type RowActionId =
  | "cancel"
  | "editReceipt"
  | "ship"
  | "returnGoods"
  | "complete"
  | "markLost"
  | "markProblem"
  | "resolveDispute";

/** Which end of an order may press an action: its selling team, its warehouse, or either. */
export type ActionSide = "selling" | "warehouse" | "either";

export interface RowAction {
  id: RowActionId;
  icon: LucideIcon;
  /** Terminal or hard to walk back — goes through a ConfirmDialog, never a bare click. */
  destructive?: boolean;
  /** The status this action moves the order INTO, through OrderStatusChange. Absent: not a plain move. */
  to?: OrderStatus;
  /** Which end may press it. */
  side: ActionSide;
}

const CANCEL: RowAction = { id: "cancel", icon: Ban, destructive: true, side: "selling" };
// "Edit Resi" — not a move, so it opens its own dialog (`EditReceiptDialog`). The selling team's only: the
// marketplace issues the number on the seller's label (the-seller-edits-the-resi-until-handover).
const EDIT_RECEIPT: RowAction = { id: "editReceipt", icon: Pencil, side: "selling" };
// "Jadikan Dikirim" — customer service sees the parcel moving on the platform.
const SHIP: RowAction = { id: "ship", icon: Truck, to: OrderStatus.SHIPPED, side: "selling" };
const RETURN_GOODS: RowAction = {
  id: "returnGoods",
  icon: Undo2,
  destructive: true,
  to: OrderStatus.RETURN,
  side: "either",
};
const COMPLETE: RowAction = { id: "complete", icon: CircleCheck, to: OrderStatus.COMPLETED, side: "selling" };
const MARK_LOST: RowAction = {
  id: "markLost",
  icon: PackageX,
  destructive: true,
  to: OrderStatus.LOST,
  side: "selling",
};
// "Tandai Bermasalah" — customer service sees a problem on the platform (customer-service-sets-shipped-and-problem-by-hand).
// Not destructive: `problem` is a waystation that still completes, returns or is lost — it ends nothing.
const MARK_PROBLEM: RowAction = {
  id: "markProblem",
  icon: CircleAlert,
  to: OrderStatus.PROBLEM,
  side: "selling",
};
// "Selesaikan Sengketa" — the dispute closed, so the order completes.
const RESOLVE_DISPUTE: RowAction = {
  id: "resolveDispute",
  icon: Gavel,
  to: OrderStatus.COMPLETED,
  side: "selling",
};

/**
 * The owner's table, keyed by status.
 *
 * `lost`, `return_completed` and `cancel` are deliberately empty — all three are ends. `completed` offers only
 * the return: its Edit Withdrawal went (no-withdrawal-is-typed-on-an-order). An empty list still renders the
 * kebab, because "open the order" is always offered.
 */
const BY_STAGE: Record<OrderStageId, RowAction[]> = {
  pending: [CANCEL, EDIT_RECEIPT],
  processed: [EDIT_RECEIPT],
  picked: [EDIT_RECEIPT],
  shipping: [SHIP, RETURN_GOODS],
  shipped: [RETURN_GOODS, COMPLETE, MARK_PROBLEM, MARK_LOST],
  completed: [RETURN_GOODS],
  problem: [RESOLVE_DISPUTE, RETURN_GOODS, MARK_LOST],
  lost: [],
  return: [MARK_LOST],
  return_completed: [],
  cancel: [],
};

/**
 * What this order offers its reader, in menu order.
 *
 * `side` is which end the READER is: `warehouse` when the reader is this order's warehouse, `selling`
 * otherwise. An action the other end makes is left out.
 */
export function rowActionsFor(stage: OrderStageId, side: "selling" | "warehouse"): RowAction[] {
  return BY_STAGE[stage].filter((action) => action.side === "either" || action.side === side);
}
