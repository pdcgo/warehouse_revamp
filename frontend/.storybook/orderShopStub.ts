// selling_service's FIX OF AN ORDER'S SHOP as Storybook's stub (an-orders-shop-is-fixed-and-counted-on-the-day) —
// OrderShopUpdate, and the shop and the note it leaves, which the order's detail read passes through.
//
// It refuses what the server refuses: an order the caller's team did not sell (NotFound), one not yet handed over or
// cancelled — anything but shipping, shipped, problem, completed, return, return completed, lost (FailedPrecondition),
// a shop not of the order's team (NotFound) or not of its marketplace (FailedPrecondition,
// a-shops-marketplace-and-team-are-fixed), and a shop the story's writer may not write (PermissionDenied naming it,
// a-write-needs-a-grant-or-a-manager). The shop it is in now writes nothing. A fix holds for the rest of the story;
// preview.tsx's reset (resetOrderNotes) clears it.

import { Code, ConnectError } from "@connectrpc/connect";

import type { OrderShopUpdateRequest } from "../src/gen/warehouse/selling/v1/order_pb";
import { OrderStatus, OrderTimelineFrom } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDetailFor, users } from "./fixtures";
import { scenarioStatus } from "./returnAcceptStub";
import { shopForWrite } from "./shopStub";

type ShopFixNote = {
  id: bigint;
  status: OrderStatus;
  note: string;
  from: OrderTimelineFrom;
  actorId: bigint;
  createdAtUnix: bigint;
};

let fixedShops = new Map<string, bigint>();
let fixNotes = new Map<string, ShopFixNote[]>();
let nextFixLogId = 9_500n;

/** What the story asked last — for a play function to read. */
export const orderShopFixScenario = { last: undefined as OrderShopUpdateRequest | undefined };

export function resetOrderShopFixes() {
  fixedShops = new Map();
  fixNotes = new Map();
  nextFixLogId = 9_500n;
  orderShopFixScenario.last = undefined;
}

/** The shop order `orderId` reads in — the story's fix, or the fixture's. */
export function shopOf(order: { id: bigint; shopId: bigint }): bigint {
  return fixedShops.get(order.id.toString()) ?? order.shopId;
}

/** The note rows the story's fixes wrote on order `orderId`. */
export function shopFixNotesOf(orderId: bigint): ShopFixNote[] {
  return fixNotes.get(orderId.toString()) ?? [];
}

// shopFixable's statuses (selling_v1/order_shop_update.go): from handover on.
const FIXABLE = new Set([
  OrderStatus.SHIPPING,
  OrderStatus.SHIPPED,
  OrderStatus.PROBLEM,
  OrderStatus.COMPLETED,
  OrderStatus.RETURN,
  OrderStatus.RETURN_COMPLETED,
  OrderStatus.LOST,
]);

export function orderShopUpdate(req: OrderShopUpdateRequest) {
  orderShopFixScenario.last = req;

  const fixture = orderDetailFor(req.orderId);
  if (!fixture || fixture.teamId !== req.teamId) throw new ConnectError("order not found", Code.NotFound);

  const order = { ...scenarioStatus(fixture), shopId: shopOf(fixture) };

  if (!FIXABLE.has(order.status)) {
    throw new ConnectError(
      "an order's shop is fixed from handover on — shipping, shipped, problem, completed, return, return completed or lost",
      Code.FailedPrecondition,
    );
  }

  const to = shopForWrite(req.shopId);
  if (!to || to.shop.teamId !== order.teamId) throw new ConnectError("shop not found", Code.NotFound);

  const from = shopForWrite(order.shopId);
  if (from && from.shop.marketplace !== to.shop.marketplace) {
    throw new ConnectError("the order's shop can only be fixed to a shop of the same marketplace", Code.FailedPrecondition);
  }

  if (!to.writable) {
    throw new ConnectError(`You have no access to ${to.shop.name} — ask the team's owner or admin for it`, Code.PermissionDenied);
  }

  if (order.shopId === req.shopId) return { order };

  const key = order.id.toString();
  fixedShops.set(key, req.shopId);
  fixNotes.set(key, [
    ...shopFixNotesOf(order.id),
    {
      id: nextFixLogId++,
      status: OrderStatus.UNSPECIFIED,
      note: `Toko: ${from?.shop.name ?? ""} → ${to.shop.name}`,
      from: OrderTimelineFrom.SELLING,
      actorId: users[0]!.id,
      createdAtUnix: BigInt(Math.floor(Date.now() / 1000)),
    },
  ]);

  return { order: { ...order, shopId: req.shopId } };
}
