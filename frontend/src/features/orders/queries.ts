import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderClient } from "../../api/clients";
import { key } from "../../api/queryClient";

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

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The selling side's three writes. All of them stay inside `["orders"]`, and that is a statement
// about the design rather than an omission:
//
//   - `OrderCreate` does NOT touch inventory (§3.3 — stock integration is #69, still blocked), so
//     placing an order cannot stale a stock figure. The day #69 lands, THIS is the hook that has to
//     start invalidating stock, and it is the reason the write lives here rather than in the page.
//   - `OrderCancel` reverses no stock or money either — that is #70, and it waits on #69.
//
// The fulfilment steps (pick/pack/ship) DO move goods, and they are in src/picking/queries.ts.

export function useCreateOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderCreate>[0]) => orderClient.orderCreate(vars),
    onSuccess: () => invalidate(),
  });
}

export function useConfirmOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderConfirm>[0]) =>
      orderClient.orderConfirm(vars),
    onSuccess: () => invalidate(),
  });
}

export function useCancelOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderCancel>[0]) => orderClient.orderCancel(vars),
    onSuccess: () => invalidate(),
  });
}
