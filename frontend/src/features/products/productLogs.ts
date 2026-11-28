import { useQuery } from "@tanstack/react-query";

import { productClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";

// THE PRODUCT'S HISTORY (backlog #150; the-team-code-and-product-tags-prototype-is-accepted, *the history*) — the lines
// the product page's Riwayat Produk card draws: today the code a product took when its team's code changed (old → new,
// who, when — a-team-code-change-recomposes-its-product-codes), read from ProductService.ProductLogList, newest first,
// paged (HARD RULE 9: it grows with every change). Keyed in the products' domain, so the team code edit's invalidation
// (features/teams/teamCode.ts) re-reads it with the product itself.

/** ProductLogList's roles — the team that owns the product, Root and the Administrator (UX only). */
export function readsProductHistory(role: Role | undefined): boolean {
  return (
    role === Role.ROOT ||
    role === Role.ADMINISTRATOR ||
    role === Role.SELLING_OWNER ||
    role === Role.SELLING_ADMIN ||
    role === Role.SELLING_CS
  );
}

export function useProductLogs(args: {
  /** The team that OWNS the product — the read is scoped to it (another team's product is NotFound). */
  teamId: bigint | undefined;
  productId: bigint;
  page: number;
  pageSize: number;
  enabled?: boolean;
}) {
  const { teamId, productId, page, pageSize, enabled = true } = args;

  return useQuery({
    queryKey: key.products(teamId, { logs: productId.toString(), page, pageSize }),
    // A page turn refines the same history — the lines stay up while the next page loads (HARD RULE 10).
    ...listQuery,
    enabled: enabled && teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await productClient.productLogList({ teamId: teamId!, productId, page: { page, limit: pageSize } });

      return { logs: res.logs, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}
