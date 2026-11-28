import { useQuery } from "@tanstack/react-query";
import { shopClient, userClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { publicUsersByIds, userByIdsRowData } from "../../features/users/adapt";

// The shop page's own read (#122): WHO MAY WORK ON THIS SHOP — its grants, in the server's order, and each person named.
//
// The two calls are ONE value: the grants first (ShopUserList), then their names (UserByIDs), committed together, as
// the section always read them. A failure of EITHER is the section's error — it says so and lists nobody — which is
// why this is not features/shops' useShopUsers: that one names a missing person "#id" and never fails on the names, for
// the primary-CS dialog. Its own key under `shops`, so a shop write re-reads it; a shop is worked by a handful, so one
// page of 100 covers them.
//
// READ BY THE PAGE, BESIDE THE SHOP (#134, the-speed-audits-old-findings-are-fixed-smallest-first): it needs only the
// address's shop and the team, so it no longer waits for ShopDetail to answer and the section to mount — the speed
// audit's ShopDetail → ShopUserList → UserByIDs. The section takes this answer as a prop (a second reader of the key,
// mounting after the first had answered, would ask again at `staleTime: 0`).
export function useShopGrants(args: { teamId: bigint | undefined; shopId: bigint }) {
  const { teamId, shopId } = args;

  return useQuery({
    queryKey: key.shops(teamId, { grants: shopId.toString() }),
    enabled: teamId !== undefined && shopId > 0n,
    queryFn: async () => {
      const res = await shopClient.shopUserList({
        teamId: teamId!,
        filter: { shopId },
        page: { page: 1, limit: 100 },
      });
      // The user ids live in the guideline `ids` channel.
      const users =
        res.ids.length > 0
          ? publicUsersByIds(await userClient.userByIDs({ filter: { ids: res.ids }, dataRequest: userByIdsRowData() }))
          : {};

      return { ids: res.ids, users };
    },
  });
}

/** The grants read as the page hands it to its access section. */
export type ShopGrantsRead = ReturnType<typeof useShopGrants>;
