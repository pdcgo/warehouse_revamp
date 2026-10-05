import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { toaster } from "../../components/feedback/Toaster";
import { useAdvanceOrderFulfilment } from "../../features/picking/queries";
import type { WarehouseStep } from "./steps";
import { rpcFor, stepLabelKey, stepOfStatus } from "./steps";

// MOVING AN ORDER TO ANOTHER STEP — the one runner the row menu, the bulk bar and the scan dialogs share,
// so a move from any of them behaves the same.
//
// A move the RPCs can make (one step forward) runs for real. Any other — a skip, a move back, a move into
// "Sudah diambil" — has no RPC yet and says so instead of pretending (`stepMove`).
export function useStepMove(warehouseId: bigint | undefined) {
  const { t } = useTranslation();
  const advance = useAdvanceOrderFulfilment();

  /** Moves ONE order; returns whether it moved. `quiet` leaves the toast to the caller (bulk, scans). */
  async function move(order: Order, to: WarehouseStep, quiet = false): Promise<boolean> {
    const from = stepOfStatus(order.status);

    if (!from || warehouseId === undefined) return false;

    const rpc = rpcFor(from, to);

    if (!rpc) {
      if (!quiet) toaster.create({ type: "info", title: t("warehouseOrders.pending.stepMove.reason") });
      return false;
    }

    try {
      await advance.mutateAsync({ warehouseId, orderId: order.id, step: rpc });
      if (!quiet) toaster.create({ type: "success", title: t("warehouseOrders.moved", { step: t(stepLabelKey(to)) }) });
      return true;
    } catch (err) {
      if (!quiet) toaster.create({ type: "error", title: rpcError(err) });
      return false;
    }
  }

  return { move, busy: advance.isPending };
}
