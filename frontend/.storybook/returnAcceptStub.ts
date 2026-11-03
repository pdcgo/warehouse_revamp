// selling_service's RETURN ACCEPT as Storybook's stub (the-accept-is-the-status-return-completed) — OrderReturnAccept, and
// the status it moves, which every order read in the stub passes through.
//
// The fixtures hold no order in `return` (one would move every count a list story pins), so a story says which orders
// the stub reads in `return` with `withOrdersInReturn`, and an accept moves one to `return_completed` for the rest of that
// story. preview.tsx's `beforeEach` resets the scenario (resetSessionScenario).
//
// It refuses what the server refuses — the selling team (PermissionDenied), an order not in `return` the caller cannot read
// (NotFound), one it can (FailedPrecondition), a charge with no note (InvalidArgument) — and answers the labels the story set: the server derives them from the return maps,
// which is a rule for the Go tests, not for a picture of the dialog.

import { Code, ConnectError } from "@connectrpc/connect";

import type { OrderReturnAcceptRequest } from "../src/gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailFor } from "./fixtures";
import { returnWarehouseOf } from "./returnConfigurationStub";
import { returnAcceptScenario } from "./sessionScenario";

/** An order's status as the stub reads it: the fixture's, unless the story's return scenario says otherwise. */
export function scenarioStatus<T extends { id: bigint; status: OrderStatus }>(order: T): T {
  if (returnAcceptScenario.accepted.includes(order.id)) {
    return { ...order, status: OrderStatus.RETURN_COMPLETED };
  }

  if (returnAcceptScenario.inReturn.includes(order.id)) {
    return { ...order, status: OrderStatus.RETURN };
  }

  return order;
}

/**
 * Whether `teamId` reads this order, as the server's `orderReaders` decides it: its selling team, its warehouse — and the
 * selling team's CONFIGURED return warehouse while the order is a return (a-return-may-land-in-another-warehouse). Pass the
 * order through `scenarioStatus` first, so a story's return reads as one.
 */
export function readsOrder(order: { teamId: bigint; warehouseId: bigint; status: OrderStatus }, teamId: bigint): boolean {
  if (order.teamId === teamId || order.warehouseId === teamId) return true;

  const returning = order.status === OrderStatus.RETURN || order.status === OrderStatus.RETURN_COMPLETED;

  return returning && returnWarehouseOf(order.teamId) === teamId;
}

// ANY warehouse accepts a return — whichever holds the parcel (the-accept-records-where-it-was-accepted); an order in any
// other status reads NotFound unless the caller reads it, and the order's selling team is refused: it claims a return.
export function orderReturnAccept(req: OrderReturnAcceptRequest) {
  const found = orderDetailFor(req.orderId);
  const order = found && scenarioStatus(found);
  if (!order || (order.status !== OrderStatus.RETURN && !readsOrder(order, req.teamId))) {
    throw new ConnectError("order not found", Code.NotFound);
  }

  if (order.teamId === req.teamId && order.warehouseId !== req.teamId) {
    throw new ConnectError("a return is accepted by the warehouse holding the parcel", Code.PermissionDenied);
  }

  if (order.status === OrderStatus.RETURN_COMPLETED) {
    throw new ConnectError("this return is already accepted", Code.FailedPrecondition);
  }
  if (order.status !== OrderStatus.RETURN) {
    throw new ConnectError("only an order in return can be accepted", Code.FailedPrecondition);
  }

  if (req.courierCharge > 0n && req.courierChargeNote.trim() === "") {
    throw new ConnectError("say what the courier's charge was for", Code.InvalidArgument);
  }

  returnAcceptScenario.last = {
    orderId: req.orderId,
    missing: req.missingLines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
    courierCharge: req.courierCharge,
    courierChargeNote: req.courierChargeNote,
  };

  if (returnAcceptScenario.refusal) {
    throw new ConnectError(returnAcceptScenario.refusal, Code.FailedPrecondition);
  }

  returnAcceptScenario.inReturn = returnAcceptScenario.inReturn.filter((id) => id !== req.orderId);
  returnAcceptScenario.accepted = [...returnAcceptScenario.accepted, req.orderId];

  return {
    order: { ...order, status: OrderStatus.RETURN_COMPLETED },
    labels: returnAcceptScenario.labels,
  };
}
