import { useState } from "react";
import { Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Eye, MoreHorizontal } from "lucide-react";

import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { toaster } from "../../../components/feedback/Toaster";
import { rpcError } from "../../../api/clients";
import { useCancelOrder } from "../../../features/orders/queries";
import { useAdvanceOrderFulfilment } from "../../../features/picking/queries";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { ORDERS_LIST_PENDING } from "../pending";
import type { RowAction } from "../rowActions";
import { rowActionsFor } from "../rowActions";
import type { OrderStageId } from "../stages";

// THE ROW'S ACTIONS — the house kebab, rendering the owner's per-status table (`rowActions.ts`).
//
// ⚠ IT IS A RENDERING OF A RULE, NOT A PILE OF CONDITIONS. Which items an order offers is decided in
// one place and this file only draws them, so "what can I do to a returned order" is answered by
// reading a table rather than by tracing branches through JSX.
//
// ⚠ TWO OF THE NINE ARE REAL. Detail navigates and Cancel calls `OrderCancel`; Ship calls
// `OrderShip`, but only for the warehouse holding the parcel. The other six do nothing yet and each
// one SAYS SO TWICE — the ⚠ on the item, and a toast naming the reason when it is pressed. A menu
// item that silently does nothing is the worst of the three states, because the reader concludes the
// app is broken rather than unfinished.
//
// ⚠ AN ILLEGAL ACTION IS ABSENT, NEVER GREYED. The house rule from `restock-selling`: a disabled item
// is a question the reader has to answer, an absent one is never asked.

export function OrderRowActions({
  teamId,
  orderId,
  status,
  stage,
  warehouseId,
}: {
  /** The team whose list this is — the caller, not the order's owner. */
  teamId: bigint | undefined;
  orderId: bigint;
  status: OrderStatus;
  /** Which of the owner's eight the order is in — the key to the action table. */
  stage: OrderStageId | undefined;
  /** The warehouse fulfilling it. Equal to `teamId` when a crew is reading its own queue. */
  warehouseId: bigint;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cancelMutation = useCancelOrder();
  const advanceMutation = useAdvanceOrderFulfilment();

  // The dialog is opened FROM a menu item, so it is controlled: a `trigger` inside `Menu.Content`
  // would be unmounted by the menu closing before the dialog ever opened.
  const [confirming, setConfirming] = useState<RowAction | null>(null);

  // ⚠ `OrderShip` is scoped to the building. Offering it to a seller would be offering a call the
  // access interceptor refuses — see the note in `rowActions.ts`.
  const canFulfil = teamId !== undefined && teamId === warehouseId;

  // ⚠ `withdrawalTotal` IS NOT PASSED, and that is the honest state: no field carries it, so the
  // owner's "kalau wd_total > 0" gate on a returned order cannot be evaluated. Undefined skips the
  // gate rather than guessing, and the `withdrawal` mark says why.
  const actions = stage ? rowActionsFor(stage, status, { canFulfil }) : [];

  async function run(action: RowAction) {
    if (action.pending) {
      // Named, not a generic "coming soon": the reason is already written once, in the summary at
      // the top of the screen, and this is the same sentence.
      toaster.create({
        type: "info",
        title: t(`orders.rowAction.${action.id}`),
        description: t(`orders.pending.${action.pending}.reason`),
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
    if (action.destructive && !action.pending) {
      setConfirming(action);
      return;
    }

    void run(action);
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("orders.actions")}
            data-testid={`order-actions-${orderId}`}
          >
            <Icon as={MoreHorizontal} boxSize="4" />
          </IconButton>
        </Menu.Trigger>

        <Portal>
          <Menu.Positioner>
            <Menu.Content>
              {/* Always first, and always real — every order can be opened. */}
              <Menu.Item
                value="detail"
                data-testid={`order-detail-${orderId}`}
                onClick={() => navigate(`/orders/${orderId}`)}
              >
                <Icon as={Eye} boxSize="4" />
                {t("orders.viewDetail")}
              </Menu.Item>

              {actions.map((action) => (
                <Menu.Item
                  key={action.id}
                  value={action.id}
                  color={action.destructive ? "fg.error" : undefined}
                  data-testid={`order-${action.id}-${orderId}`}
                  onClick={() => press(action)}
                >
                  <Icon as={action.icon} boxSize="4" />
                  {t(`orders.rowAction.${action.id}`)}
                  {action.pending && (
                    <NotImplemented list={ORDERS_LIST_PENDING} id={action.pending} />
                  )}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {/* One dialog for every destructive item, its words chosen by which one opened it — the same
          pattern and the same copy the detail page uses for cancel, because it is the same act from
          a different place. */}
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
    </>
  );
}
