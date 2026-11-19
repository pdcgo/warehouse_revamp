// THE BULK PICK LIST'S READS as Storybook's stub (the-bulk-pick-list-prototype-is-accepted): selling's OrderPickLines and
// inventory's StockPickLocations for MANY takes — the same contract the server answers (features/picking/bulkPick.ts):
//
//   OrderPickLines      1–50 unique ids (InvalidArgument otherwise); the orders that SHIP FROM the asking warehouse — any,
//                       for the root team — in the asked order, with their take (`pickTransactionOf`), status (the
//                       story's scenario, returnAcceptStub), shop (orderShopStub) and lines (OrderDetail's items), never
//                       money. Another building's order, or no such order, is absent.
//   StockPickLocations  one take (`transactionId`, the single pick page — answered as before) or 1–50 (`transactionIds`),
//                       exactly one of the two; a take of another building adds nothing; each stop names its take.
//
// What each read received is recorded in bulkPickScenario.ts for the stories to assert.

import { Code, ConnectError } from "@connectrpc/connect";

import type { StockPickLocationsRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import type { OrderPickLinesRequest } from "../src/gen/warehouse/selling/v1/order_pb";
import { bulkPickScenario } from "./bulkPickScenario";
import { PICK_TX_BASE, orderDetailFor, orders, pickLocationsByTransaction, pickLocationsFor } from "./fixtures";
import { shopOf } from "./orderShopStub";
import { scenarioStatus } from "./returnAcceptStub";

/** The cap of both reads — the warehouse list's largest page. */
const MAX_IDS = 50;

function refuseIds(ids: bigint[], field: string, min: number) {
  if (ids.length < min || ids.length > MAX_IDS) {
    throw new ConnectError(`${field}: ${min} to ${MAX_IDS} ids`, Code.InvalidArgument);
  }

  if (new Set(ids).size !== ids.length || ids.some((id) => id <= 0n)) {
    throw new ConnectError(`${field}: each id once, and above 0`, Code.InvalidArgument);
  }
}

export function orderPickLines(req: OrderPickLinesRequest) {
  bulkPickScenario.pickLines.push({ teamId: req.teamId, orderIds: [...req.orderIds] });
  refuseIds(req.orderIds, "order_ids", 1);

  if (bulkPickScenario.refusal) {
    throw new ConnectError(bulkPickScenario.refusal, Code.Unavailable);
  }

  const answered = req.orderIds.flatMap((id) => {
    const fixture = orders.find((order) => order.id === id);
    const shipsHere = fixture !== undefined && (req.teamId === 1n || fixture.warehouseId === req.teamId);
    const detail = shipsHere ? orderDetailFor(id) : undefined;
    if (!fixture || !detail) return [];

    return [
      {
        orderId: id,
        transactionId: detail.transactionId,
        status: scenarioStatus(fixture).status,
        shopId: shopOf(fixture),
        orderExternalRefId: fixture.orderExternalRefId ?? "",
        shipmentChannelId: fixture.shipmentChannelId,
        receiptCode: fixture.receiptCode,
        lines: detail.items.map((item) => ({
          productId: item.productId,
          productCode: item.productCode,
          name: item.name,
          quantity: item.quantity,
        })),
      },
    ];
  });

  return { orders: answered };
}

export function stockPickLocations(req: StockPickLocationsRequest) {
  const many = req.transactionIds.length > 0;

  if (many === req.transactionId > 0n) {
    throw new ConnectError("name exactly one of transaction_id or transaction_ids", Code.InvalidArgument);
  }

  // ONE TAKE — the single pick page, answered as it always was, each stop now naming its take.
  if (!many) {
    return {
      locations: pickLocationsByTransaction(req.transactionId).map((loc) => ({ ...loc, transactionId: req.transactionId })),
    };
  }

  bulkPickScenario.manyTakes.push({ warehouseId: req.warehouseId, transactionIds: [...req.transactionIds] });
  refuseIds(req.transactionIds, "transaction_ids", 1);

  // MANY TAKES, in take order, ONLY this building's: a take of another warehouse's order adds nothing.
  const takes = [...req.transactionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    locations: takes.flatMap((take) => {
      const order = orders.find((o) => o.id === take - PICK_TX_BASE);
      if (!order || order.warehouseId !== req.warehouseId) return [];

      return pickLocationsFor(order.id).map((loc) => ({ ...loc, transactionId: take }));
    }),
  };
}
