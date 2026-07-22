import { useQuery, useQueryClient } from "@tanstack/react-query";
import { orderClient } from "../api/clients";
import { key } from "../api/queryClient";

// The order screens' reads (#176).

export function useOrders(args: { teamId: bigint | undefined; page: number; pageSize: number }) {
  const { teamId, page, pageSize } = args;

  return useQuery({
    queryKey: key.orders(teamId, { page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderList({ teamId: teamId!, page: { page, limit: pageSize } });

      return {
        orders: res.orders,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

export function useOrder(args: { teamId: bigint | undefined; orderId: bigint }) {
  const { teamId, orderId } = args;

  return useQuery({
    queryKey: key.orders(teamId, { orderId: orderId.toString() }),
    enabled: teamId !== undefined && orderId > 0n,
    queryFn: async () => {
      const res = await orderClient.orderDetail({ teamId: teamId!, orderId });

      return res.order ?? null;
    },
  });
}

// Confirm and cancel happen on the DETAIL page and change a status the LIST also shows. Invalidating
// the whole domain is what keeps the two honest: without it, confirming an order and pressing back
// shows the status it had before — the screen is not wrong about anything it fetched, it simply
// fetched before the change.
//
// The same applies to creating an order, which lands on the detail page and leaves a list behind it.
export function useInvalidateOrders() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["orders"] });
}
