import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { useAdvanceOrderFulfilment } from "../picking/queries";
import { useCancelOrder } from "./queries";
import type { RowAction } from "./rowActions";
import { rowActionsFor } from "./rowActions";
import type { OrderStageId } from "./stages";

// WHAT AN ORDER OFFERS, AND WHAT PRESSING ONE DOES — the runner, shared by every place that draws the
// actions.
//
// Two screens draw them differently: the list folds them behind a kebab (twenty rows of buttons is a
// wall), the detail page shows them as buttons and folds only the overflow. They must still DO the same
// thing — the same confirm on a destructive act, the same toast on an unbuilt one, the same mutation —
// so the doing lives here and each screen only draws.
//
// ⚠ IT RETURNS THE DIALOG, and the caller renders it. The confirm is opened FROM a menu item or a
// button, so it is controlled: a `trigger` inside `Menu.Content` would be unmounted by the menu closing
// before the dialog ever opened.
//
// ⚠ AN ILLEGAL ACTION IS ABSENT, NEVER GREYED — `actions` holds only what this order can take now.

export function useOrderActions({
  teamId,
  orderId,
  status,
  stage,
  warehouseId,
  pendingNs,
}: {
  /** The team reading the order — the caller, not the order's owner. */
  teamId: bigint | undefined;
  orderId: bigint;
  status: OrderStatus;
  /** Which of the owner's eight the order is in — the key to the action table. */
  stage: OrderStageId | undefined;
  /** The warehouse fulfilling it. Equal to `teamId` when a crew is reading its own queue. */
  warehouseId: bigint;
  /**
   * Where the screen's pending copy lives. An unbuilt action toasts the SAME sentence its screen's
   * summary strip carries, so the reader never gets two explanations of one gap.
   */
  pendingNs: string;
}): { actions: RowAction[]; press: (action: RowAction) => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const cancelMutation = useCancelOrder();
  const advanceMutation = useAdvanceOrderFulfilment();

  const [confirming, setConfirming] = useState<RowAction | null>(null);

  // ⚠ `OrderShip` is scoped to the building. Offering it to a seller would be offering a call the
  // access interceptor refuses — see the note in `rowActions.ts`.
  const canFulfil = teamId !== undefined && teamId === warehouseId;

  // ⚠ `withdrawalTotal` IS NOT PASSED: no field carries it, so the owner's "kalau wd_total > 0" gate on
  // a returned order cannot be evaluated. Undefined skips the gate rather than guessing.
  const actions = stage ? rowActionsFor(stage, status, { canFulfil }) : [];

  async function run(action: RowAction) {
    if (action.pending) {
      toaster.create({
        type: "info",
        title: t(`orders.rowAction.${action.id}`),
        description: t(`${pendingNs}.pending.${action.pending}.reason`),
      });
      return;
    }

    if (teamId === undefined) {
      return;
    }

    try {
      if (action.id === "cancel") {
        await cancelMutation.mutateAsync({ teamId, orderId });
        toaster.create({ type: "success", title: t("orders.orderCancelled") });
        return;
      }

      if (action.id === "ship") {
        await advanceMutation.mutateAsync({ warehouseId, orderId, step: "ship" });
        toaster.create({ type: "success", title: t("orders.orderShipped") });
      }
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  function press(action: RowAction) {
    // An unbuilt destructive action does not confirm — there is nothing to confirm, and a dialog
    // asking "are you sure?" about a button that does nothing is two lies in a row.
    if (action.destructive && !action.pending) {
      setConfirming(action);
      return;
    }

    void run(action);
  }

  // One dialog for every destructive action, its words chosen by which one opened it.
  const dialog = (
    <ConfirmDialog
      open={confirming !== null}
      onOpenChange={(open) => !open && setConfirming(null)}
      title={confirming ? t(`orders.rowAction.${confirming.id}`) : ""}
      message={
        confirming
          ? t(`orders.rowActionConfirm.${confirming.id}`, { id: orderId.toString() })
          : ""
      }
      confirmLabel={confirming ? t(`orders.rowAction.${confirming.id}`) : ""}
      onConfirm={async () => {
        if (confirming) {
          await run(confirming);
        }
      }}
    />
  );

  return { actions, press, dialog };
}
