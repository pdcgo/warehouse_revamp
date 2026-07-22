import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, productClient } from "../api/clients";
import { key } from "../api/queryClient";

// The product screens' reads (#176). Hooks live beside their screens, per api/queryClient.ts.

interface ProductListArgs {
  teamId: bigint | undefined;
  isWarehouse: boolean;
  q: string;
  page: number;
  pageSize: number;
}

// The team's catalogue — or, for a WAREHOUSE, what it has been asked to hold.
//
// A warehouse owns no products (they belong to selling teams), so `ProductList` scoped to it
// correctly returns nothing. What it should see is inventory's arrangement list, resolved to names
// by product_service. Two calls on purpose: mirroring the catalogue into inventory would put a
// product's name in two places, and the copy would go stale the first time anyone renamed it.
//
// `isWarehouse` is in the key even though it is derived from the team. It changes WHICH RPC answers,
// so two cache entries that disagree about that must not collide — and a key that reads
// `{ isWarehouse: true }` says why the entry exists without tracing it back through team type.
export function useProducts({ teamId, isWarehouse, q, page, pageSize }: ProductListArgs) {
  return useQuery({
    queryKey: key.products(teamId, { isWarehouse, q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      if (isWarehouse) {
        const arrangement = await inventoryClient.warehouseProductList({
          warehouseId: teamId!,
          page: { page, limit: pageSize },
        });

        const totalItems = Number(arrangement.pageInfo?.totalItems ?? 0n);

        // No ids means no second call — ProductByIds with an empty list is a request for nothing.
        if (arrangement.productIds.length === 0) {
          return { products: [], totalItems };
        }

        const resolved = await productClient.productByIds({
          teamId: teamId!,
          productIds: arrangement.productIds,
        });

        return { products: resolved.products, totalItems };
      }

      const res = await productClient.productList({
        teamId: teamId!,
        q,
        page: { page, limit: pageSize },
      });

      return {
        products: res.products,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Broad on purpose, for the same reason as expenses: a delete changes the page it was on and every
// page after it, and the counts with them.
export function useInvalidateProducts() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["products"] });
}
