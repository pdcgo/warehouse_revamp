import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import { orderStatusLabelKey } from "../../components/badges/OrderStatusBadge";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { EditReceiptDialog } from "./EditReceiptDialog";
import { useCancelOrder, useOrderStatusChange } from "./queries";
import type { RowAction } from "./rowActions";
import { rowActionsFor } from "./rowActions";
import type { OrderStageId } from "./stages";

// WHAT AN ORDER OFFERS, AND WHAT PRESSING ONE DOES — the runner, shared by every place that draws the
// actions.
//
// Two screens draw them differently: the list folds them behind a kebab (twenty rows of buttons is a
// wall), the detail page shows them as buttons and folds only the overflow. They must still DO the same
// thing — the same confirm on a destructive act, the same dialog, the same mutation — so the doing lives
// here and each screen only draws.
//
// ⚠ IT RETURNS THE DIALOGS, and the caller renders them. A confirm or Edit Resi is opened FROM a menu
// item or a button, so each is controlled: a `trigger` inside `Menu.Content` would be unmounted by the
// menu closing before the dialog ever opened.
//
// ⚠ AN ILLEGAL ACTION IS ABSENT, NEVER GREYED — `actions` holds only what this order can take now, and
// only the ones the reader's end of the order may make.

export function useOrderActions({
  teamId,
  orderId,
  stage,
  warehouseId,
}: {
  /** The team reading the order — the caller, not the order's owner. */
  teamId: bigint | undefined;
  orderId: bigint;
  /** Which status the order is in — the key to the action table. */
  stage: OrderStageId | undefined;
  /** The warehouse fulfilling it. Equal to `teamId` when a crew is reading its own queue. */
  warehouseId: bigint;
}): { actions: RowAction[]; press: (action: RowAction) => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const cancelMutation = useCancelOrder();
  const moveMutation = useOrderStatusChange();
  const [confirming, setConfirming] = useState<RowAction | null>(null);
  const [editingReceipt, setEditingReceipt] = useState(false);

  const side = teamId !== undefined && teamId === warehouseId ? "warehouse" : "selling";
  const actions = stage ? rowActionsFor(stage, side) : [];

  async function run(action: RowAction) {
    if (teamId === undefined) {
      return;
    }

    try {
      if (action.id === "cancel") {
        await cancelMutation.mutateAsync({ teamId, orderId });
        toaster.create({ type: "success", title: t("orders.orderCancelled") });
        return;
      }

      if (action.to !== undefined) {
        const [result] = await moveMutation.mutateAsync({ teamId, orderIds: [orderId], to: action.to });

        // A refusal is an answer, not a failure of the call — the server says why in its own words.
        if (!result?.moved) {
          toaster.create({
            type: "error",
            title: t(`orders.rowAction.${action.id}`),
            description: result?.refusedReason,
          });
          return;
        }

        toaster.create({
          type: "success",
          title: t("orders.statusMoved", { status: t(orderStatusLabelKey(action.to)) }),
        });
      }
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  function press(action: RowAction) {
    if (action.id === "editReceipt") {
      setEditingReceipt(true);
      return;
    }

    if (action.destructive) {
      setConfirming(action);
      return;
    }

    void run(action);
  }

  const dialog = (
    <>
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

      {/* Mounted only while open: it reads the order, and the list draws one runner per row. */}
      {teamId !== undefined && editingReceipt && (
        <EditReceiptDialog
          open
          onOpenChange={setEditingReceipt}
          teamId={teamId}
          orderId={orderId}
        />
      )}
    </>
  );

  return { actions, press, dialog };
}
