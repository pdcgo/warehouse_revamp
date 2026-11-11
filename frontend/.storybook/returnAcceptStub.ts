// selling_service's RETURN ACCEPT as Storybook's stub (the-accept-is-the-status-return-completed) — OrderReturnAccept, and
// the status it moves, which every order read in the stub passes through.
//
// The fixtures hold no order in `return` (one would move every count a list story pins), so a story says which orders
// the stub reads in `return` with `withOrdersInReturn`, and an accept moves one to `return_completed` for the rest of that
// story. preview.tsx's `beforeEach` resets the scenario (resetSessionScenario).
//
// It refuses what the server refuses — an order not in `return` the caller cannot read (NotFound), one it can
// (FailedPrecondition), a warehouse that is not the selling team's return warehouse (FailedPrecondition naming where it
// goes, only-the-return-warehouse-accepts-a-return), a line missing or twice, broken + missing above the line, racks that
// do not hold exactly the sound units, a rack twice or another building's, a charge with no note (InvalidArgument) — and
// answers the labels the story set: the server derives them from the return maps, which is a rule for the Go tests, not
// for a picture of the page.

import { Code, ConnectError } from "@connectrpc/connect";

import type { OrderReturnAcceptRequest, OrderStatusChangeRequest } from "../src/gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailFor, orders, racks, teams } from "./fixtures";
import { returnWarehouseOf } from "./returnConfigurationStub";
import { returnAcceptScenario } from "./sessionScenario";

/**
 * An order as the stub reads it: the fixture's status, unless the story's return scenario says otherwise — and, as the
 * server's reads do (the-return-warehouse-is-read-when-the-return-happens), where its return goes: its selling team's
 * configured return warehouse, read now (0 when the team has none).
 */
export function scenarioStatus<T extends { id: bigint; teamId: bigint; status: OrderStatus }>(order: T): T {
  const read = { ...order, returnWarehouseId: returnWarehouseOf(order.teamId) };

  if (returnAcceptScenario.accepted.includes(order.id)) {
    return { ...read, status: OrderStatus.RETURN_COMPLETED };
  }

  if (returnAcceptScenario.inReturn.includes(order.id)) {
    return { ...read, status: OrderStatus.RETURN };
  }

  const story = returnAcceptScenario.statusOf[order.id.toString()];
  if (story !== undefined) {
    return { ...read, status: story };
  }

  return read;
}

/** OrderDetail's `return_labels` — the borrowed lines' own products to print, while the order is in `return`. */
export function returnLabelsOf(order: { id: bigint; status: OrderStatus; items: { id: bigint }[] }) {
  if (order.status !== OrderStatus.RETURN) return [];

  return returnAcceptScenario.labels.filter((label) => order.items.some((item) => item.id === label.orderItemId));
}

// The statuses an order may be returned from (a-forced-return-follows-the-status-move) — the server's orderMoves edges into
// `return`, by customer service or forced by the warehouse.
const RETURNS_FROM = [OrderStatus.SHIPPING, OrderStatus.SHIPPED, OrderStatus.PROBLEM, OrderStatus.COMPLETED];

/**
 * OrderStatusChange as the stub answers it: either end of an order moves it (the server's per-edge side rule is the Go
 * tests'). A move INTO `return` follows orderMoves — only from shipping, shipped, problem or completed, else refused per
 * order — and is KEPT for the rest of the story (the order reads in `return`), so a forced return is then accepted. Every
 * other move is answered and forgotten, as before.
 */
export function orderStatusChange(req: OrderStatusChangeRequest) {
  return {
    results: req.orderIds.map((orderId) => {
      const found = orders.find((o) => o.id === orderId && (o.teamId === req.teamId || o.warehouseId === req.teamId));
      if (!found) {
        return { orderId, moved: false, refusedReason: "not one of this team's orders" };
      }

      if (req.to === OrderStatus.RETURN) {
        if (!RETURNS_FROM.includes(scenarioStatus(found).status)) {
          return { orderId, moved: false, refusedReason: "an order returns only once it has left the warehouse" };
        }

        returnAcceptScenario.inReturn = [...returnAcceptScenario.inReturn, orderId];
      }

      return { orderId, moved: true, status: req.to };
    }),
  };
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

const teamName = (id: bigint) => teams.find((t) => t.id === id)?.name ?? `#${id}`;

// ONLY THE RETURN WAREHOUSE ACCEPTS A RETURN (only-the-return-warehouse-accepts-a-return) — with its stock half: per line
// the broken and missing units and the sound units' racks (return_decision.md). The order's selling team is refused: it
// claims a return, never accepts one.
export function orderReturnAccept(req: OrderReturnAcceptRequest) {
  returnAcceptScenario.calls += 1;
  returnAcceptScenario.last = {
    teamId: req.teamId,
    orderId: req.orderId,
    lines: req.lines.map((line) => ({
      orderItemId: line.orderItemId,
      broken: line.broken,
      missing: line.missing,
      note: line.note,
      placements: line.placements.map((p) => ({ rackId: p.rackId, quantity: p.quantity })),
    })),
    courierCharge: req.courierCharge,
    courierChargeNote: req.courierChargeNote,
  };

  const found = orderDetailFor(req.orderId);
  const order = found && scenarioStatus(found);
  if (!order || !readsOrder(order, req.teamId)) {
    throw new ConnectError("order not found", Code.NotFound);
  }

  if (order.teamId === req.teamId && order.warehouseId !== req.teamId) {
    throw new ConnectError("a return is accepted by its return warehouse", Code.PermissionDenied);
  }

  if (order.status === OrderStatus.RETURN_COMPLETED) {
    throw new ConnectError("this return is already accepted", Code.FailedPrecondition);
  }
  if (order.status !== OrderStatus.RETURN) {
    throw new ConnectError("only an order in return can be accepted", Code.FailedPrecondition);
  }

  const goesTo = returnWarehouseOf(order.teamId);
  if (goesTo === 0n) {
    throw new ConnectError(`${teamName(order.teamId)} has no return warehouse`, Code.FailedPrecondition);
  }
  if (goesTo !== req.teamId) {
    throw new ConnectError(`this return goes to ${teamName(goesTo)}`, Code.FailedPrecondition);
  }

  const ids = req.lines.map((l) => l.orderItemId.toString());
  if (new Set(ids).size !== ids.length || ids.length !== order.items.length) {
    throw new ConnectError("every line of the order, once", Code.InvalidArgument);
  }

  for (const line of req.lines) {
    const item = order.items.find((i) => i.id === line.orderItemId);
    if (!item) throw new ConnectError("a line that is not the order's", Code.InvalidArgument);

    const sound = item.quantity - line.broken - line.missing;
    if (sound < 0) {
      throw new ConnectError(`${item.productCode}: broken and missing are more than the line`, Code.InvalidArgument);
    }

    const placed = line.placements.reduce((sum, p) => sum + p.quantity, 0);
    if (placed !== sound) {
      throw new ConnectError(`${item.productCode}: the racks hold ${placed}, ${sound} are sound`, Code.InvalidArgument);
    }

    const rackIds = line.placements.map((p) => p.rackId.toString());
    if (new Set(rackIds).size !== rackIds.length) {
      throw new ConnectError(`${item.productCode}: a rack twice`, Code.InvalidArgument);
    }
    if (line.placements.some((p) => !racks.some((r) => r.id === p.rackId && r.warehouseId === req.teamId))) {
      throw new ConnectError(`${item.productCode}: a rack of another warehouse`, Code.InvalidArgument);
    }
  }

  if (req.courierCharge > 0 && req.courierChargeNote.trim() === "") {
    throw new ConnectError("say what the courier's charge was for", Code.InvalidArgument);
  }

  if (returnAcceptScenario.refusal) {
    throw new ConnectError(returnAcceptScenario.refusal, Code.FailedPrecondition);
  }

  returnAcceptScenario.inReturn = returnAcceptScenario.inReturn.filter((id) => id !== req.orderId);
  returnAcceptScenario.accepted = [...returnAcceptScenario.accepted, req.orderId];

  // The labels, per sound unit now the count is in (OrderReturnLabel.quantity).
  const labels = returnLabelsOf(order).map((label) => {
    const line = req.lines.find((l) => l.orderItemId === label.orderItemId);
    const item = order.items.find((i) => i.id === label.orderItemId);

    return { ...label, quantity: (item?.quantity ?? 0) - (line?.broken ?? 0) - (line?.missing ?? 0) };
  });

  return {
    order: { ...order, status: OrderStatus.RETURN_COMPLETED },
    labels,
  };
}
