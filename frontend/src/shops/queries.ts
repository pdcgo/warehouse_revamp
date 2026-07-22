import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shopClient } from "../api/clients";
import { key } from "../api/queryClient";
import type { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";

// The shop screens' reads (#176).

export function useShops(args: {
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.shops(teamId, { q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await shopClient.shopList({ teamId: teamId!, q, page: { page, limit: pageSize } });

      return {
        shops: res.shops,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// One shop. `shopId` is in the key with the team: the same id under two teams is two different
// records, and the detail page is reachable by URL, so the id cannot be trusted to belong to the
// team the caller is currently in.
export function useShop(args: { teamId: bigint | undefined; shopId: bigint }) {
  const { teamId, shopId } = args;

  return useQuery({
    queryKey: key.shops(teamId, { shopId: shopId.toString() }),
    enabled: teamId !== undefined && shopId > 0n,
    queryFn: async () => {
      const res = await shopClient.shopDetail({ teamId: teamId!, shopId });

      return res.shop ?? null;
    },
  });
}

// Broad: an edit changes the row in the list AND the detail page, and a delete changes every page
// after it. One invalidation covers both screens.
export function useInvalidateShops() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["shops"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale — see
// src/expenses/queries.ts for the full argument. It matters more here than anywhere: ShopFormDialog
// is opened from TWO places (the list and the detail page), and under the old `onDone` prop each
// caller wired its own refetch, so "does the screen update?" was answered twice and could be answered
// differently.
//
// The split: the hook owns the CACHE, the component owns the UX (the toast, closing the dialog,
// showing the error). `onSuccess` RETURNS the invalidation promise so TanStack awaits it — the dialog
// must not close a beat before the renamed row appears.
//
// ONLY `shops` is invalidated, and that is worth stating because a rename LOOKS like it should reach
// orders and expenses. It does not: both store `shop_id` alone (proto `Order.shop_id`,
// `ExpenseRecord.shop_id`) with no denormalised copy of the name, so there is nothing on those rows
// for a rename to make stale. `["shops"]` is prefix-broad on purpose and covers both screens: the
// list keys by filter+page, the detail page keys by id, and an edit or a delete can change either.

interface SaveShopVars {
  teamId: bigint;
  /** Set to edit an existing shop; omitted to create one. */
  shopId?: bigint;
  name: string;
  shopCode: string;
  marketplace: Marketplace;
  description: string;
}

// Create or edit a shop. ONE hook for both, because the edit form IS the create form re-opened on an
// existing record — the same reason ShopFormDialog serves both modes.
export function useSaveShop() {
  const invalidate = useInvalidateShops();

  return useMutation({
    mutationFn: async ({ shopId, ...vars }: SaveShopVars) =>
      shopId === undefined
        ? await shopClient.shopCreate(vars)
        : await shopClient.shopUpdate({ ...vars, shopId }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteShop() {
  const invalidate = useInvalidateShops();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; shopId: bigint }) => shopClient.shopDelete(vars),
    onSuccess: () => invalidate(),
  });
}
