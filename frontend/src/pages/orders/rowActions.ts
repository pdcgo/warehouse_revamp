import { Ban, CircleCheck, Gavel, PackageX, Pencil, Truck, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import type { PendingId } from "./pending";
import type { OrderStageId } from "./stages";

// WHAT YOU CAN DO TO AN ORDER, BY THE STATE IT IS IN (owner) — the whole table in one place, so the
// kebab is a rendering of a rule rather than a pile of conditions.
//
// The owner gave it in the OLD status names:
//
//   created           → Batalkan Order, Edit Resi
//   process           → Edit Resi
//   shipped           → Jadikan Dikirim, Retur Barang, Selesaikan Order
//   courrier_shipped  → Retur Barang, Selesaikan Order
//   return            → Jadikan Lost, Selesaikan Order (only when wd_total > 0)
//   completed         → Edit Withdrawal
//   problem           → Selesaikan Sengketa
//
// ⚠ TWO OF THOSE ROWS FOLD INTO ONE STAGE, and that is the one judgement call here. The owner's
// eight put "sudah diserahkan" INSIDE `processed` as its last step, so the old `shipped` (handed
// over, not yet moving) is a step of `processed` and the old `courrier_shipped` (moving) is the new
// `shipped`. The three actions the owner hung on old-`shipped` therefore belong to the END of
// `processed`, not to the new `shipped`.
//
//   old shipped          → new processed, last step   → Jadikan Dikirim, Retur Barang, Selesaikan
//   old courrier_shipped → new shipped                → Retur Barang, Selesaikan
//
// ⚠ AND THE STEP IT NEEDS DOES NOT EXIST. There is no `HANDED_OVER` enum value — the contract still
// carries the old six (the `statusSet` mark) — so the gate falls back to `PACKED`, the last step
// before handover that IS representable. An order that is packed but not yet handed to the courier
// will be offered "Jadikan Dikirim" one step early until the enum lands. Same cause as the tabs, so
// it is the same mark rather than a new one.
//
// ⚠ "JADIKAN DIKIRIM" IS THE WAREHOUSE'S, NOT THE SELLER'S — and that is the contract's ruling, not
// a preference. `OrderShip` takes the WAREHOUSE's team id and the handler finds the order by
// `(order_id, warehouse_id)`, "so a crew can only ever touch orders" of their own building
// (order.proto). A seller pressing it would be calling on a team it is not a member of, which the
// access interceptor refuses. It is offered to the building holding the parcel.
//
// It reads correctly against the owner's other ruling this week, too: THE ONGKIR IS THE WAREHOUSE'S
// TO SET. Handing the parcel over and pricing its shipment are the same side of the job.
//
// ⚠ NOTHING IS GREYED OUT. An action an order cannot take is ABSENT — the house rule the cancel item
// already followed, and what `restock-selling` settled: a disabled item is a question a reader has to
// answer ("why not?"), an absent one is not asked.

export type RowActionId =
  | "cancel"
  | "editReceipt"
  | "ship"
  | "returnGoods"
  | "complete"
  | "markLost"
  | "editWithdrawal"
  | "resolveDispute";

export interface RowAction {
  id: RowActionId;
  icon: LucideIcon;
  /** Terminal or hard to walk back — goes through a ConfirmDialog, never a bare click. */
  destructive?: boolean;
  /**
   * The pending entry that explains why it does nothing yet. Absent = the action is REAL.
   *
   * ⚠ THREE DIFFERENT CAUSES, and each points at the entry that already holds it rather than a new
   * one per button (HARD RULE 11 — group by cause, not by symptom):
   *
   *   editReceipt     → `receiptCode`   there is no tracking-number FIELD to edit
   *   editWithdrawal  → `withdrawal`    a wallet→bank withdrawal has nowhere to be recorded
   *   the rest        → `lifecycle`     the order's life past "shipped" has no RPCs at all
   */
  pending?: PendingId;
}

const CANCEL: RowAction = { id: "cancel", icon: Ban, destructive: true };
const EDIT_RECEIPT: RowAction = { id: "editReceipt", icon: Pencil, pending: "receiptCode" };
const SHIP: RowAction = { id: "ship", icon: Truck };
const RETURN_GOODS: RowAction = {
  id: "returnGoods",
  icon: Undo2,
  destructive: true,
  pending: "lifecycle",
};
const COMPLETE: RowAction = { id: "complete", icon: CircleCheck, pending: "lifecycle" };
const MARK_LOST: RowAction = {
  id: "markLost",
  icon: PackageX,
  destructive: true,
  pending: "lifecycle",
};
const EDIT_WITHDRAWAL: RowAction = {
  id: "editWithdrawal",
  icon: Pencil,
  pending: "withdrawal",
};
const RESOLVE_DISPUTE: RowAction = { id: "resolveDispute", icon: Gavel, pending: "lifecycle" };

/**
 * The owner's table, keyed by the decided eight.
 *
 * `lost` and `cancel` are deliberately empty — the owner listed no action for either, and both are
 * ends: a lost parcel is written off and a cancelled order is done. An empty list still renders the
 * kebab, because "open the order" is always offered.
 */
const BY_STAGE: Record<OrderStageId, RowAction[]> = {
  pending: [CANCEL, EDIT_RECEIPT],
  processed: [EDIT_RECEIPT],
  shipped: [RETURN_GOODS, COMPLETE],
  completed: [EDIT_WITHDRAWAL],
  problem: [RESOLVE_DISPUTE],
  lost: [],
  return: [MARK_LOST, COMPLETE],
  cancel: [],
};

/** The handover step's three, folded into `processed` — see the note above. */
const AT_HANDOVER: RowAction[] = [SHIP, RETURN_GOODS, COMPLETE];

/**
 * What this order offers, in menu order.
 *
 * `canFulfil` is "the reader IS this order's warehouse" — see the note above.
 *
 * `withdrawalTotal` gates the `return` stage's "Selesaikan Order": the owner's rule is *"kalau
 * wd_total > 0"* — a returned order is only closed once the money has come back. ⚠ THERE IS NO SUCH
 * FIELD, so the caller passes `undefined` and the gate is skipped rather than guessed; the
 * `withdrawal` entry is the mark that says so.
 */
export function rowActionsFor(
  stage: OrderStageId,
  status: OrderStatus,
  opts: { canFulfil: boolean; withdrawalTotal?: bigint },
): RowAction[] {
  const { canFulfil, withdrawalTotal } = opts;

  let actions = BY_STAGE[stage];

  if (stage === "processed" && status === OrderStatus.PACKED) {
    // The handover three. `ship` is the warehouse's alone; the other two are offered either way,
    // because nothing says returning goods or closing an order belongs to one side.
    actions = [...actions, ...AT_HANDOVER.filter((a) => a.id !== "ship" || canFulfil)];
  }

  if (stage === "return" && withdrawalTotal !== undefined && withdrawalTotal <= 0n) {
    actions = actions.filter((a) => a.id !== "complete");
  }

  return actions;
}
