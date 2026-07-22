import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, productClient } from "../api/clients";
import { key } from "../api/queryClient";

// The inventory screens' reads (#176).

// One page of a warehouse's catalogue, with the on-hand level for each row.
//
// Both calls in one query function, as the old effect had them: a product row without its count is
// not a stock screen, and rendering the names first would show a column of blanks that reads as
// "zero" rather than "still loading".
//
// The levels call asks for ONE large page rather than matching the product pager — it is a lookup
// table for the rows on screen, not a list in its own right.
export function useWarehouseStock(args: {
  warehouseId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
  levelLimit: number;
}) {
  const { warehouseId, q, page, pageSize, levelLimit } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { q, page, pageSize }),
    enabled: warehouseId !== undefined,
    queryFn: async () => {
      const [productRes, stockRes] = await Promise.all([
        productClient.productList({
          teamId: warehouseId!,
          q,
          page: { page, limit: pageSize },
        }),
        inventoryClient.stockList({ warehouseId: warehouseId!, page: { page: 1, limit: levelLimit } }),
      ]);

      const onHand = new Map<string, bigint>();
      for (const level of stockRes.levels) {
        onHand.set(level.productId.toString(), level.onHand);
      }

      return {
        products: productRes.products,
        onHand,
        totalItems: Number(productRes.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Receive, adjust and move all change what is on a shelf, so they all land here.
//
// This also invalidates RESTOCK and RACKS, because stock is the thing those screens are about: a
// receive completes a restock, and a move changes what a rack holds. Cross-domain invalidation is
// rare in this codebase and deliberate here — the alternative is a rack page that shows what was on
// the shelf before somebody moved it.
export function useInvalidateStock() {
  const client = useQueryClient();

  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["restock"] }),
      client.invalidateQueries({ queryKey: ["racks"] }),
    ]);
  };
}
