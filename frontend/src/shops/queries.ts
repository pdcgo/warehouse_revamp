import { useQuery, useQueryClient } from "@tanstack/react-query";
import { shopClient } from "../api/clients";
import { key } from "../api/queryClient";

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
