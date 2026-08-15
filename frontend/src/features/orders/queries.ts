import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderListRowData, ordersFromList } from "./adapt";

// The order screens' reads (#176).

// The filters the LIST and the STAT share — search, shop, and the date window.
//
// One type used by both hooks, deliberately. The header sits directly above the table, so the two
// calls must be given the same narrowing or the counts describe a bigger population than the rows;
// making it one object is what stops a caller passing the search to one and forgetting the other.
// `status` is not here: it is the tab, and it belongs to the list alone.
export interface OrderFilters {
  /** Free text over the customer's name, their phone, and the order id. "" = no filter. */
  search: string;
  /** Only orders placed on this shop. 0n = no filter. */
  shopId: bigint;
  /** The `created_at` window, unix seconds, inclusive. 0n on a side is an OPEN end. */
  fromUnix: bigint;
  toUnix: bigint;
}

export const NO_ORDER_FILTERS: OrderFilters = {
  search: "",
  shopId: 0n,
  fromUnix: 0n,
  toUnix: 0n,
};

// bigints are not JSON-serialisable and TanStack hashes keys with JSON.stringify, so the filters go
// into the key as strings — the same rule the team id already follows in api/queryClient.ts.
const filterKey = (f: OrderFilters) => ({
  search: f.search,
  shopId: f.shopId.toString(),
  fromUnix: f.fromUnix.toString(),
  toUnix: f.toUnix.toString(),
});

const filterMsg = (f: OrderFilters) => ({
  search: f.search,
  shopId: f.shopId,
  createdFromUnix: f.fromUnix,
  createdToUnix: f.toUnix,
});

export function useOrders(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
  status: OrderStatus;
  filters?: OrderFilters;
}) {
  const { teamId, page, pageSize, status, filters = NO_ORDER_FILTERS } = args;

  return useQuery({
    // `listQuery`: the status tab, the filter bar and the pager all REFINE the same question — "this
    // team's orders" — so the rows already on screen stay put while the next answer loads, instead of
    // the table tearing down. That matters most for the SEARCH BOX: it re-queries as somebody types,
    // and a table that blanked between keystrokes would be unusable however fast the server answered.
    // The page pairs it with a RefreshOverlay, which is the other half.
    ...listQuery,
    queryKey: key.orders(teamId, { page, pageSize, status, ...filterKey(filters) }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderList({
        teamId: teamId!,
        filter: { status, ...filterMsg(filters) },
        dataRequest: orderListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        orders: ordersFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The header above the list: the census by status, and the last thirty days of money.
//
// Deliberately NOT keyed on the tab or the page. The counts are what you read to decide which tab to
// open, so recomputing them per tab would empty the very number you were about to click — and turning
// a page cannot change them. The key carries only what the stat is actually filtered by.
//
// It IS keyed on the search, the shop and the date window, and that is the other half of the same
// rule: those three change which orders exist for the screen, so a header that ignored them would
// count a population the table below it does not show — "Placed 12" over four rows, with nothing
// explaining the gap. The server shares one query builder between the two RPCs for the same reason.
export function useOrderStat(args: {
  teamId: bigint | undefined;
  productId?: bigint;
  filters?: OrderFilters;
}) {
  const { teamId, productId = 0n, filters = NO_ORDER_FILTERS } = args;

  return useQuery({
    queryKey: key.orders(teamId, {
      stat: 1,
      productId: productId.toString(),
      ...filterKey(filters),
    }),
    enabled: teamId !== undefined,
    queryFn: () =>
      orderClient.orderStat({ teamId: teamId!, filter: { productId, ...filterMsg(filters) } }),
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

// There is no useConfirmOrder here any more (owner). Confirming is the WAREHOUSE accepting the job, so
// it lives with the crew's other three steps in features/picking/queries.ts — one hook that advances an
// order and invalidates STOCK alongside orders, which this one never did because a selling-side confirm
// moved no goods. A second confirm hook here would be a second way to make the same call, and the one
// that skips the stock invalidation is the one somebody would reach for by name.

export function useCancelOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderCancel>[0]) => orderClient.orderCancel(vars),
    onSuccess: () => invalidate(),
  });
}
