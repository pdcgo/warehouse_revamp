import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import type { Order, OrderStatusChangeResult } from "../../gen/warehouse/selling/v1/order_pb";
import { toaster } from "../../components/feedback/Toaster";
import { useOrderStatusChange } from "../../features/orders/queries";
import type { WarehouseStep } from "./steps";
import { stepLabelKey, statusOfStep } from "./steps";

// MOVING ORDERS TO ANOTHER STEP — the one runner the row menu, the bulk bar and the scan dialogs share,
// so a move from any of them behaves the same.
//
// ONE CALL FOR THE WHOLE LIST (one-status-change-for-every-plain-move): a bulk move or a handover batch
// is a single OrderStatusChange, and each order comes back with its own result. A refusal never blocks
// the rest — the toast says how many moved and why the others did not, in the server's words.
export function useStepMove(warehouseId: bigint | undefined) {
  const { t } = useTranslation();
  const change = useOrderStatusChange();

  /**
   * Moves these orders to `to` and returns each one's result ([] when nothing could be asked).
   * `note` is the reason a move back needs. `quiet` leaves the feedback to the caller (the scan dialogs
   * answer with a sound).
   */
  async function move(
    list: Order[],
    to: WarehouseStep,
    opts: { note?: string; quiet?: boolean } = {},
  ): Promise<OrderStatusChangeResult[]> {
    const { note = "", quiet = false } = opts;

    if (warehouseId === undefined || list.length === 0) return [];

    try {
      const results = await change.mutateAsync({
        teamId: warehouseId,
        orderIds: list.map((order) => order.id),
        to: statusOfStep(to),
        note,
      });

      if (!quiet) {
        const moved = results.filter((result) => result.moved).length;
        const refused = results.filter((result) => !result.moved);
        const step = t(stepLabelKey(to));

        if (moved > 0) {
          toaster.create({
            type: "success",
            title: list.length > 1 ? `${t("warehouseOrders.moved", { step })} (${moved})` : t("warehouseOrders.moved", { step }),
          });
        }

        if (refused.length > 0) {
          toaster.create({
            type: "warning",
            title: t("warehouseOrders.notMoved", { count: refused.length }),
            description: refused.map((result) => `#${result.orderId}: ${result.refusedReason}`).join("\n"),
          });
        }
      }

      return results;
    } catch (err) {
      if (!quiet) toaster.create({ type: "error", title: rpcError(err) });
      return [];
    }
  }

  return { move, busy: change.isPending };
}
