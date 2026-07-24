import { useMutation, useQuery } from "@tanstack/react-query";
import { inventoryClient, orderClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { useInvalidateOrders } from "../orders/queries";
import { useInvalidateStock } from "../inventory/queries";

// The three moves a warehouse crew makes on an order, in the only order they may happen.
export type FulfilmentStep = "pick" | "pack" | "ship";

// The ref inventory_service recorded this order's draw under (#149). selling_service builds the same
// string; it is the handle that ties an order to the shelves its goods were taken from.
function stockRef(orderId: bigint): string {
  return `order:${orderId}`;
}

// The picking screens' reads (#176).
//
// These are keyed under the ORDERS domain, not a picking one, because that is what they read: the
// queue is an order list scoped to the warehouse, and the pick screen is an order plus where its
// goods sit. Keying them here means `useInvalidateOrders` — which picking, the selling team's list
// and the order detail all call — keeps every view of the same order in step. A separate "picking"
// domain would have let a picker advance an order and leave the seller's list showing the old
// status.

export function usePickQueue(args: {
  warehouseId: bigint | undefined;
  status: number;
  page: number;
  pageSize: number;
}) {
  const { warehouseId, status, page, pageSize } = args;

  return useQuery({
    queryKey: key.orders(warehouseId, { picking: true, status, page, pageSize }),
    enabled: warehouseId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderList({
        teamId: warehouseId!,
        page: { page, limit: pageSize },
        status,
      });

      return {
        orders: res.orders,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The order and the shelves its lines sit on, fetched TOGETHER and returned as one value — the lines
// are useless without the shelves and the shelves meaningless without the lines, so a partial screen
// would be worse than a slower one. That was true of the old effect and is why both stay in one
// query function rather than becoming two queries that can render half-arrived.
export function usePickOrder(args: { warehouseId: bigint | undefined; orderId: bigint }) {
  const { warehouseId, orderId } = args;

  return useQuery({
    queryKey: key.orders(warehouseId, { picking: true, orderId: orderId.toString() }),
    enabled: warehouseId !== undefined && orderId > 0n,
    queryFn: async () => {
      const [detail, places] = await Promise.all([
        orderClient.orderDetail({ teamId: warehouseId!, orderId }),
        inventoryClient.stockPickLocations({ warehouseId: warehouseId!, ref: stockRef(orderId) }),
      ]);

      return {
        order: detail.order ?? null,
        locations: places.locations,
      };
    },
  });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The crew advancing an order: CONFIRMED → PICKING → PACKED → SHIPPED.
//
// ⚠ PICKING IS WHAT MOVES STOCK (#151). So this is the third cross-domain write in the app, alongside
// accepting a restock and adjusting a shelf: the goods leave the racks they were sitting on, which
// stales the warehouse stock screen and the rack pages just as surely as a manual adjustment does.
// Invalidating `["orders"]` alone would advance the order on every screen that shows its status while
// leaving the shelf it was picked from still claiming to hold the goods.
//
// ONE hook for all three steps, invalidating stock on each — not just on the pick. Packing and
// shipping move nothing, so the extra invalidation is redundant on two steps out of three. That is
// deliberate: an invalidation conditional on which branch ran is a rule the next person editing this
// has to remember, and the cost of being wrong (a shelf that lies) is far higher than the cost of
// being broad (a stale mark on queries nobody is looking at).
export function useAdvanceOrderFulfilment() {
  const invalidateOrders = useInvalidateOrders();
  const invalidateStock = useInvalidateStock();

  return useMutation({
    // Returns nothing on purpose. The three RPCs have three different response types, and no caller
    // reads any of them — the new status arrives through the invalidation below, which is the whole
    // point: writing the response into local state would advance the order in hand while the queue
    // behind it still listed the job as waiting.
    mutationFn: async (vars: {
      warehouseId: bigint;
      orderId: bigint;
      step: FulfilmentStep;
    }): Promise<void> => {
      const req = { teamId: vars.warehouseId, orderId: vars.orderId };

      switch (vars.step) {
        case "pick":
          await orderClient.orderPick(req);
          break;
        case "pack":
          await orderClient.orderPack(req);
          break;
        case "ship":
          await orderClient.orderShip(req);
          break;
      }
    },
    onSuccess: () => Promise.all([invalidateOrders(), invalidateStock()]),
  });
}
