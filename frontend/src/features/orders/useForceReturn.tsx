import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderStatusLabelKey } from "../../components/badges/OrderStatusBadge";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { useOrderStatusChange } from "./queries";

// THE WAREHOUSE'S FORCED RETURN (a-return-is-received-by-search-then-forced) — the parcel is in the crew's hands, but
// customer service has not claimed it back yet. The crew moves the order to `return` itself, then accepts it.
//
// ⚠ ONLY FROM THE FOUR STATUSES THE STATUS MOVE GIVES A `return` EDGE (a-forced-return-follows-the-status-move): the goods
// left the building. A pending, processed or picked order never left, and an end status has nowhere to go — so they are
// never offered it, and the receive search says why in a sentence instead.
//
// It is the existing plain move (OrderStatusChange to `return`) — no new server rule — behind a ConfirmDialog, because
// it is hard to walk back: nothing moves an order out of `return` but the accept or a write-off.
export const FORCE_RETURN_FROM: readonly OrderStatus[] = [
  OrderStatus.SHIPPING,
  OrderStatus.SHIPPED,
  OrderStatus.PROBLEM,
  OrderStatus.COMPLETED,
];

export function canForceReturn(status: OrderStatus): boolean {
  return FORCE_RETURN_FROM.includes(status);
}

/** The order the confirm asks about — its id and the status it is in now. */
export interface ForceReturnTarget {
  id: bigint;
  status: OrderStatus;
}

/**
 * The confirm and the move. `ask(order)` opens the confirm; on a move, `onForced(order)` runs — the receive search opens
 * Accept Return straight away, the order page lets its re-read show the Accept Return button.
 *
 * Returns the dialog for the caller to render (it is opened from a button or a result row, so it is controlled).
 */
export function useForceReturn({
  teamId,
  onForced,
}: {
  /** The warehouse forcing it — the caller's team. */
  teamId: bigint | undefined;
  onForced?: (order: ForceReturnTarget) => void;
}): { ask: (order: ForceReturnTarget) => void; busy: boolean; dialog: ReactNode } {
  const { t } = useTranslation();
  const move = useOrderStatusChange();
  const [asking, setAsking] = useState<ForceReturnTarget | null>(null);

  async function force() {
    const order = asking;
    if (teamId === undefined || !order) return;

    try {
      const [result] = await move.mutateAsync({ teamId, orderIds: [order.id], to: OrderStatus.RETURN });

      // A refusal is an answer, not a failed call — the server says why in its own words.
      if (!result?.moved) {
        toaster.create({ type: "error", title: t("picking.forceReturn.failed"), description: result?.refusedReason });
        return;
      }

      toaster.create({ type: "success", title: t("picking.forceReturn.done") });
      onForced?.(order);
    } catch (err) {
      toaster.create({ type: "error", title: t("picking.forceReturn.failed"), description: rpcError(err) });
    }
  }

  const dialog = (
    <ConfirmDialog
      open={asking !== null}
      onOpenChange={(open) => !open && setAsking(null)}
      title={t("picking.forceReturn.title")}
      message={
        asking
          ? t("picking.forceReturn.message", { id: asking.id.toString(), status: t(orderStatusLabelKey(asking.status)) })
          : ""
      }
      confirmLabel={t("picking.action.forceReturn")}
      onConfirm={force}
    />
  );

  return { ask: setAsking, busy: move.isPending, dialog };
}
