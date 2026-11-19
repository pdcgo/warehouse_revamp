import { useQuery } from "@tanstack/react-query";
import { inventoryClient, orderClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The picking screens' reads (#176).
//
// These are keyed under the ORDERS domain, not a picking one, because that is what they read: the
// queue is an order list scoped to the warehouse (the warehouse's list reads `useOrders` as the warehouse), and the
// pick screen is an order plus where its goods sit. Keying them here means `useInvalidateOrders` — which picking, the selling team's list
// and the order detail all call — keeps every view of the same order in step. A separate "picking"
// domain would have let a picker advance an order and leave the seller's list showing the old
// status.

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
      // The order first: its `transactionId` names the take (the-placement-page-reads-racks-by-transaction-id). The
      // take runs before the order row exists, so the order keeps the take's inventory transaction for exactly this
      // read. An order with no transaction has taken nothing, so there is no shelf to walk to.
      const detail = await orderClient.orderDetail({ teamId: warehouseId!, orderId });
      const order = detail.order ?? null;
      const transactionId = order?.transactionId ?? 0n;

      const places =
        transactionId > 0n
          ? await inventoryClient.stockPickLocations({ warehouseId: warehouseId!, transactionId })
          : { locations: [] };

      return {
        order,
        locations: places.locations,
      };
    },
  });
}

// THE BULK PICK LIST'S READ (the-bulk-pick-list-prototype-is-accepted): the ticked orders' lines, then where their takes
// drew each line from — like the single pick page above, both in ONE query function, because a list of lines with no
// racks (or racks with no lines) would send the crew walking with half the answer.
//
//   OrderPickLines      the orders that ship from this warehouse, in the asked order, with their takes and lines
//   StockPickLocations  every take at once (`transactionIds`), one query on the server, each rack named by its take
//
// An order that took nothing (transaction 0) is asked no racks; its lines read as "no recorded shelf". With no take to
// read, the second call is not made. The shops' names are labels and come from `useShopsByIds` beside it.
export function useBulkPick(args: { warehouseId: bigint | undefined; ids: bigint[] }) {
  const { warehouseId, ids } = args;

  return useQuery({
    queryKey: key.orders(warehouseId, { bulkPick: ids.join(",") }),
    enabled: warehouseId !== undefined && ids.length > 0,
    queryFn: async () => {
      const { orders } = await orderClient.orderPickLines({ teamId: warehouseId!, orderIds: ids });
      const takes = [...new Set(orders.map((order) => order.transactionId).filter((id) => id > 0n))];

      const places =
        takes.length > 0
          ? await inventoryClient.stockPickLocations({ warehouseId: warehouseId!, transactionIds: takes })
          : { locations: [] };

      return { orders, locations: places.locations };
    },
  });
}
