import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { categoryClient, inventoryClient, productClient } from "../api/clients";
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

// The DISCOVER list — products across every team, not just the caller's (#106).
//
// Its own key rather than a flag on useProducts: it answers a different question against a different
// RPC, and sharing an entry would let one team's catalogue render under the cross-team heading.
export function useDiscoverProducts(args: {
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.products(teamId, { discover: true, q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await productClient.productDiscover({
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

// One product, with the category tree it is filed against.
//
// Both together: the detail screen names the product's category, and rendering the product before
// the tree lands would show a blank where a name belongs. The tree is global reference data, so this
// costs nothing beyond the first fetch.
export function useProductDetail(args: { teamId: bigint | undefined; productId: bigint }) {
  const { teamId, productId } = args;

  return useQuery({
    queryKey: key.products(teamId, { productId: productId.toString() }),
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const [detail, cats] = await Promise.all([
        productClient.productDetail({ teamId: teamId!, productId }),
        categoryClient.categoryList({}),
      ]);

      return {
        product: detail.product ?? null,
        categories: cats.categories,
      };
    },
  });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The catalogue's writes. Each declares its invalidation here rather than leaving the page that
// happens to call it to remember — see src/expenses/queries.ts for the reasoning.
//
// ⚠ A product write DOES cross into inventory, and not for the obvious reason. The stock screen's
// query loads the product list and the on-hand levels TOGETHER in one queryFn (see
// inventory/queries.ts `useWarehouseStock`), so a renamed or deleted product is stale data inside an
// `["inventory"]` entry that no `["products"]` invalidation would touch. The rows on that screen ARE
// products.
//
// It does NOT cross into orders: an order line SNAPSHOTS sku/name/unit_price at order time precisely
// so later catalogue edits never rewrite history, which is the whole point of freezing them.
export function useSaveProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: async (
      vars:
        | { productId: bigint; fields: Parameters<typeof productClient.productUpdate>[0] }
        | { productId?: undefined; fields: Parameters<typeof productClient.productCreate>[0] },
    ) =>
      vars.productId === undefined
        ? await productClient.productCreate(vars.fields)
        : await productClient.productUpdate({ ...vars.fields, productId: vars.productId }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (vars: Parameters<typeof productClient.productDelete>[0]) =>
      productClient.productDelete(vars),
    onSuccess: () => invalidate(),
  });
}

// The product PICKER's search (ProductSelect).
//
// `scope` chooses the RPC — the team's own catalogue, or every team's (#106) — and is in the key for
// the same reason `isWarehouse` is above: it decides which question was asked, and one answer must
// not be served under the other.
//
// A catalogue is too large to load whole, which is why this searches rather than listing. Through
// the cache a transient failure retries instead of turning into "no products found", and backing up
// a character returns to an answer already given.
export function useProductSearch(args: {
  teamId: bigint;
  q: string;
  scope: "team" | "all";
}) {
  const { teamId, q, scope } = args;

  return useQuery({
    queryKey: key.products(teamId, { search: q, scope }),
    enabled: q.length >= 2 && teamId > 0n,
    queryFn: async () => {
      const req = { teamId, q, page: { page: 1, limit: 10 } };
      const res =
        scope === "all"
          ? await productClient.productDiscover(req)
          : await productClient.productList(req);

      return res.products;
    },
  });
}

// Broad on purpose, for the same reason as expenses: a delete changes the page it was on and every
// page after it, and the counts with them.
//
// It also clears `["inventory"]`, for the reason given above the writes: the warehouse stock screen
// loads the product list INSIDE its inventory query, so the catalogue rows it renders would otherwise
// survive a rename or a delete that every other screen had already noticed.
export function useInvalidateProducts() {
  const client = useQueryClient();

  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["products"] }),
      client.invalidateQueries({ queryKey: ["inventory"] }),
    ]);
  };
}
