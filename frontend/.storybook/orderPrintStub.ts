// THE PRINT PAGE'S ONE READ as Storybook's stub (the-print-page-and-the-courier-count-prototype-is-accepted): selling's
// OrderPrintByIds, the contract the server answers —
//
//   1–50 unique ids above 0 (InvalidArgument otherwise); the orders that SHIP FROM the asking warehouse — any, for the root
//   team — in the asked order, each with its step (the story's scenario, returnAcceptStub), shop (orderShopStub), ref,
//   courier, resi, and whether a label is attached: the fixture's file, or one a story lends it through
//   `orderLabelScenario.labelled` — the same test OrderLabels' stub makes, so the page names before the print exactly the
//   orders the print leaves out for want of a label. Another building's order, or no such order, is absent. Never money.
//
// What it received is recorded in sessionScenario's `orderPrintScenario` for the stories to assert.

import { Code, ConnectError } from "@connectrpc/connect";

import type { OrderPrintByIdsRequest } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailFor } from "./fixtures";
import { shopOf } from "./orderShopStub";
import { scenarioStatus } from "./returnAcceptStub";
import { orderLabelScenario, orderPrintScenario } from "./sessionScenario";

const MAX_IDS = 50;

export function orderPrintByIds(req: OrderPrintByIdsRequest) {
  orderPrintScenario.calls.push({ teamId: req.teamId, orderIds: [...req.orderIds] });

  if (req.orderIds.length < 1 || req.orderIds.length > MAX_IDS) {
    throw new ConnectError(`order_ids: 1 to ${MAX_IDS} orders`, Code.InvalidArgument);
  }

  if (new Set(req.orderIds).size !== req.orderIds.length || req.orderIds.some((id) => id <= 0n)) {
    throw new ConnectError("order_ids: each id once, and above 0", Code.InvalidArgument);
  }

  const orders = req.orderIds.flatMap((orderId) => {
    const order = orderDetailFor(orderId);
    if (!order || (req.teamId !== 1n && order.warehouseId !== req.teamId)) return [];

    const read = scenarioStatus(order);

    return [
      {
        orderId,
        status: read.status,
        shopId: shopOf(read),
        orderExternalRefId: order.orderExternalRefId ?? "",
        shipmentChannelId: order.shipmentChannelId,
        receiptCode: order.receiptCode,
        hasLabel: Boolean(order.receipt?.documentId) || orderLabelScenario.labelled.includes(orderId),
      },
    ];
  });

  return { orders };
}
