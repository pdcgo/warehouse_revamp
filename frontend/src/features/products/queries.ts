import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { categoryClient, inventoryClient, orderClient, productClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import { ProductListDataType, ProductStatus } from "../../gen/warehouse/product/v1/product_pb";
import {
  activityFromByIds,
  batchesFromList,
  layersFromList,
  movementsFromList,
  ownerBatchData,
  ownerLayerData,
  ownerMovementData,
  ownerStockFromByIds,
  productByIdsRowData,
  productListRowData,
  productsFromByIds,
  productsFromList,
} from "./adapt";
import type { OwnerStockRow, ProductActivityRow } from "./adapt";

// The product screens' reads (#176). Hooks live beside their screens, per api/queryClient.ts.

interface ProductListArgs {
  teamId: bigint | undefined;
  isWarehouse: boolean;
  q: string;
  page: number;
  pageSize: number;
  /** Which half of the catalogue — the ACTIVE tab or the ARCHIVED one. Defaults to ACTIVE. */
  status?: ProductStatus;
  /**
   * The warehouse LENS (0n = all). It is in the KEY and not yet in the request: it will decide which
   * warehouse the stock figures describe once inventory_service exposes an owner-side read, and two
   * lenses are two different answers that must never share a cache entry — wiring the key now means
   * that day changes the queryFn only.
   */
  warehouseId?: bigint;
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
export function useProducts({
  teamId,
  isWarehouse,
  q,
  page,
  pageSize,
  status = ProductStatus.ACTIVE,
  warehouseId = 0n,
}: ProductListArgs) {
  return useQuery({
    // `status` is in the key because the two tabs are two different answers: caching the archived
    // page under the active one would show a dead SKU where the live catalogue belongs.
    queryKey: key.products(teamId, { isWarehouse, q, page, pageSize, status, warehouseId: warehouseId.toString() }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      if (isWarehouse) {
        const arrangement = await inventoryClient.warehouseProductList({
          warehouseId: teamId!,
          page: { page, limit: pageSize },
        });

        const totalItems = Number(arrangement.pageInfo?.totalItems ?? 0n);

        // No ids means no second call — ProductByIds with an empty list is a request for nothing.
        if (arrangement.ids.length === 0) {
          return { products: [], totalItems };
        }

        const resolved = await productClient.productByIds({
          teamId: teamId!,
          filter: { ids: arrangement.ids },
          dataRequest: productByIdsRowData(),
        });

        return { products: productsFromByIds(resolved), totalItems };
      }

      const res = await productClient.productList({
        teamId: teamId!,
        filter: { q, status },
        dataRequest: productListRowData(),
        page: { page, limit: pageSize },
      });

      const products = productsFromList(res.items, res.ids);
      const totalItems = Number(res.pageInfo?.totalItems ?? 0n);

      // The catalogue row carries no stock and no sales — those live in inventory_service and
      // selling_service, and each answers for the whole PAGE at once rather than per row. Two
      // batched by-ids calls, not forty: a per-row fetch is an N+1 that only shows itself once a
      // real catalogue is loaded.
      //
      // They run alongside each other because neither needs the other's answer, and they are
      // deliberately NOT their own useQuery: a row half-filled with stock and no dates (or the
      // reverse) is a flicker on every page change, and one entry means the three arrive together.
      if (res.ids.length === 0) {
        return { products, totalItems, stock: emptyStock, activity: emptyActivity };
      }

      const [stock, activity] = await Promise.all([
        inventoryClient.ownerStockByIds({
          teamId: teamId!,
          // 0n = every warehouse holding this team's goods; a chosen one restates every figure.
          filter: { productIds: res.ids, warehouseId },
        }),
        orderClient.orderProductActivityByIds({
          teamId: teamId!,
          filter: { productIds: res.ids },
        }),
      ]);

      return {
        products,
        totalItems,
        stock: ownerStockFromByIds(stock),
        activity: activityFromByIds(activity),
      };
    },
  });
}

// Shared empties, so a page with no rows still hands the table the same shape (and does not mint a
// new Map on every render for React to treat as a change).
const emptyStock: ReadonlyMap<string, OwnerStockRow> = new Map();
const emptyActivity: ReadonlyMap<string, ProductActivityRow> = new Map();

// The catalogue's headline numbers, for the stat row that sits ABOVE the tabs.
//
// Its own query, deliberately: the stats are not the tab's. They describe the whole catalogue, so
// they must not move when you switch to Archived or type in the search box — which is exactly what
// would happen if the visible table's page were their source.
//
// It asks for one row of the GENERAL slice: all it wants is `page_info.total_items`, and the cheapest
// honest way to get a count from a list RPC is the smallest page of the narrowest slice.
//
// Three services answer it — the catalogue counts itself, inventory totals the stock behind it, and
// selling says when it last sold — so the three go out together and land as one entry. The warehouse
// lens narrows the STOCK half only: how many products you have, and when you last sold one, are not
// facts about a building.
export function useProductStats(args: { teamId: bigint | undefined; warehouseId?: bigint }) {
  const { teamId, warehouseId = 0n } = args;

  return useQuery({
    queryKey: key.products(teamId, { stats: true, warehouseId: warehouseId.toString() }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const [count, stock, activity] = await Promise.all([
        // One row of the narrowest slice: all this wants is `page_info.total_items`, and that is the
        // cheapest honest way to get a count out of a list RPC.
        productClient.productList({
          teamId: teamId!,
          filter: { status: ProductStatus.ACTIVE },
          dataRequest: [ProductListDataType.GENERAL],
          page: { page: 1, limit: 1 },
        }),
        inventoryClient.ownerStockStat({ teamId: teamId!, filter: { warehouseId } }),
        orderClient.orderActivityStat({ teamId: teamId! }),
      ]);

      const preview = stock.preview;

      return {
        activeProducts: Number(count.pageInfo?.totalItems ?? 0n),
        ready: preview ? { qty: preview.readyQty, value: preview.readyValue } : undefined,
        ongoing: preview ? { qty: preview.ongoingQty, value: preview.ongoingValueEst } : undefined,
        lastRestockUnix: preview?.lastRestockUnix,
        lastOrderUnix: activity.preview?.lastOrderUnix,
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
        filter: { q },
        dataRequest: productListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        products: productsFromList(res.items, res.ids),
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

// THE CATALOGUE RECORDS BEHIND A SET OF IDS, as a map — one call for a whole screenful.
//
// What needs it: a screen that stores a SNAPSHOT of a product and wants the picture too. A restock
// line keeps `sku`/`name` as they were ordered and no image at all, so the cover has to be looked up
// by id — and looked up ONCE for every line on the page, never per row (#138's ProductByIds).
//
// ⚠ THE SNAPSHOT STILL WINS for sku and name. This read is how a page gets the IMAGE; taking the
// name from here as well would silently re-title a two-month-old restock with whatever the product is
// called today, which is the opposite of why the snapshot is stored.
//
// A missing id is simply absent from the map — ProductByIds omits what it cannot answer for, and a
// product from another team's catalogue is exactly that. The caller renders its placeholder.
export function useProductsByIds(args: { teamId: bigint | undefined; productIds: bigint[] }) {
  const { teamId } = args;
  const productIds = [...new Set(args.productIds.filter((id) => id > 0n))].sort();

  return useQuery({
    queryKey: key.products(teamId, { byIds: productIds.map(String).join(",") }),
    enabled: teamId !== undefined && productIds.length > 0,
    queryFn: async () => {
      const res = await productClient.productByIds({
        teamId: teamId!,
        filter: { ids: productIds },
        dataRequest: productByIdsRowData(),
      });

      return new Map(productsFromByIds(res).map((p) => [p.id.toString(), p]));
    },
  });
}

// The stock and selling facts for ONE product — the detail page's half of what the list gets per
// page. The same two by-ids reads, asked for a single id.
//
// A SEPARATE entry from useProductDetail, not folded into it: the catalogue record is one service's
// answer and cannot fail with the other two, while these two cross a service boundary each. Joined,
// an inventory hiccup would blank the product's name and category as well — the exact failure #176
// fixed on the warehouse product page by splitting one query into two.
//
// Both are absent-means-unknown, never zero: OwnerStockByIds omits a product it has nothing to say
// about, and "no stock row" is not the same claim as "none on a shelf" (#74).
export function useProductActivity(args: {
  teamId: bigint | undefined;
  productId: bigint;
  /** The warehouse LENS — 0n is everywhere. It restates the stock half; sales are not per-building. */
  warehouseId?: bigint;
}) {
  const { teamId, productId, warehouseId = 0n } = args;

  return useQuery({
    // The lens is in the key because a warehouse's figures are a different answer, not a filtered
    // view of the same one — serving one under the other is how a building's stock reads as a total.
    queryKey: key.products(teamId, {
      activity: productId.toString(),
      warehouseId: warehouseId.toString(),
    }),
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const [stock, activity] = await Promise.all([
        inventoryClient.ownerStockByIds({
          teamId: teamId!,
          // 0n = every warehouse holding this team's goods; a chosen one restates every figure.
          filter: { productIds: [productId], warehouseId },
        }),
        // Deliberately NOT lensed. When this product last sold is a fact about the catalogue, not
        // about a building — narrowing it by warehouse would answer a question nobody asked.
        orderClient.orderProductActivityByIds({
          teamId: teamId!,
          filter: { productIds: [productId] },
        }),
      ]);

      const id = productId.toString();

      return {
        stock: ownerStockFromByIds(stock).get(id),
        activity: activityFromByIds(activity).get(id),
      };
    },
  });
}

// ── The detail page's three ROW-level reads (#232) ──────────────────────────────────────────────
//
// Price, Batch and Stock history. Each is its OWN entry rather than one call per tab-switch: the three
// are read one at a time, they page independently, and a single query would make opening the Batch tab
// re-fetch the layers nobody is looking at.
//
// All three spread `listQuery` — they are paginated lists whose key changes REFINE the same question
// (page 2, the Jakarta lens), which is exactly what keepPreviousData is for. Pair each with a
// RefreshOverlay at the call site.
//
// The warehouse LENS is in every key. Two lenses are two different answers, not a filtered view of one
// — serving a building's figures under the total is how a partial number reads as a complete one.

export function useOwnerCostLayers(args: {
  teamId: bigint | undefined;
  productId: bigint;
  warehouseId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, productId, warehouseId, page, pageSize } = args;

  return useQuery({
    queryKey: key.products(teamId, {
      layers: productId.toString(),
      warehouseId: warehouseId.toString(),
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await inventoryClient.ownerCostLayerList({
        teamId: teamId!,
        filter: { productId, warehouseId },
        dataRequest: ownerLayerData(),
        page: { page, limit: pageSize },
      });

      return {
        layers: layersFromList(res),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        // Values the KNOWN-cost layers only — an unknown layer is worth "Unknown", not 0 (#74).
        totalValue: res.totalValue,
      };
    },
  });
}

export function useOwnerBatches(args: {
  teamId: bigint | undefined;
  productId: bigint;
  warehouseId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, productId, warehouseId, page, pageSize } = args;

  return useQuery({
    queryKey: key.products(teamId, {
      batches: productId.toString(),
      warehouseId: warehouseId.toString(),
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await inventoryClient.ownerBatchList({
        teamId: teamId!,
        filter: { productId, warehouseId },
        dataRequest: ownerBatchData(),
        page: { page, limit: pageSize },
      });

      return {
        batches: batchesFromList(res),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        readyValueTotal: res.readyValueTotal,
      };
    },
  });
}

export function useOwnerStockHistory(args: {
  teamId: bigint | undefined;
  productId: bigint;
  warehouseId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, productId, warehouseId, page, pageSize } = args;

  return useQuery({
    queryKey: key.products(teamId, {
      history: productId.toString(),
      warehouseId: warehouseId.toString(),
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await inventoryClient.ownerStockHistory({
        teamId: teamId!,
        filter: { productId, warehouseId },
        dataRequest: ownerMovementData(),
        page: { page, limit: pageSize },
      });

      return {
        movements: movementsFromList(res),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
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

// ARCHIVE. The RPC is still called ProductDelete on the wire, but nothing is deleted: the row keeps
// its id, its stock outlives it, and its past orders still name it — so every word the user reads
// says Archive, and the Archived tab is where it goes.
export function useArchiveProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (vars: Parameters<typeof productClient.productDelete>[0]) =>
      productClient.productDelete(vars),
    onSuccess: () => invalidate(),
  });
}

// LOCK / UNLOCK, edited straight from the list — one switch per row, no dialog.
//
// It is a plain ProductUpdate carrying only `cross_locked`, which works because every other field on
// that message is absent-means-untouched. A dedicated RPC would have bought nothing except a second
// place for the scope check to be got wrong.
export function useSetProductLocked() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; productId: bigint; locked: boolean }) =>
      productClient.productUpdate({
        teamId: vars.teamId,
        productId: vars.productId,
        crossLocked: vars.locked,
      }),
    onSuccess: () => invalidate(),
  });
}

// RESTORE — the way back out of the Archived tab, and the one write on these screens that can fail
// for a reason the user must act on: archiving FREES the SKU, so another product may hold it by now.
// The server refuses and names the holder; `sku` is how the caller then restores under a free one.
export function useRestoreProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (vars: Parameters<typeof productClient.productRestore>[0]) =>
      productClient.productRestore(vars),
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
    ...referenceQuery,
    enabled: q.length >= 2 && teamId > 0n,
    queryFn: async () => {
      const req = {
        teamId,
        filter: { q },
        dataRequest: productListRowData(),
        page: { page: 1, limit: 10 },
      };
      const res =
        scope === "all"
          ? await productClient.productDiscover(req)
          : await productClient.productList(req);

      return productsFromList(res.items, res.ids);
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
