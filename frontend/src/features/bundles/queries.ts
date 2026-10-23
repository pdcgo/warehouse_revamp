import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bundleClient, inventoryClient, productClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import type { SortState } from "../../components/chrome/SortableHeader";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import { BundleRowSort } from "../../gen/warehouse/product/v1/bundle_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { productByIdsRowData, productsFromByIds } from "../products/adapt";
import {
  type BundleLineRecord,
  type BundleRecord,
  bundleByIdsRowData,
  bundleListRowData,
  bundleRecord,
  bundlesFromByIds,
  bundlesFromList,
} from "./adapt";

// The bundle screens' reads and writes, against BundleService (warehouse.product.v1). In Storybook the stub
// (.storybook/bundleStub.ts) plays the same decided rules the server keeps.
//
// `teamId` on every hook is the caller's team, and the only team whose bundles come back — a bundle is never read
// across teams.

export type BundleSortKey = "name" | "updated";

export function useBundles(args: {
  teamId: bigint | undefined;
  q: string;
  /** `null` = the list's own order: the last change first. */
  sort: SortState<BundleSortKey> | null;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, sort, page, pageSize } = args;

  return useQuery({
    // A search, a sort and a page refine the same question (HARD RULE 10) — the rows stay up behind a RefreshOverlay.
    ...listQuery,
    queryKey: key.bundles(teamId, { q, sort: sort ? `${sort.by}:${sort.dir}` : "", page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await bundleClient.bundleList({
        teamId: teamId!,
        filter: { q },
        sort: sort
          ? {
              sortType: sort.dir === "asc" ? CommonSortType.ASC : CommonSortType.DESC,
              s: { case: "bundle", value: sort.by === "name" ? BundleRowSort.NAME : BundleRowSort.UPDATED_AT },
            }
          : undefined,
        dataRequest: bundleListRowData(),
        page: { page, limit: pageSize },
      });

      return { bundles: bundlesFromList(res.items, res.ids), totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

/**
 * The order form's bundle search — the first page of BundleList for `q` (empty = the last changed). A PICKER FEED, read
 * to choose a bundle and not worked from, so it is `referenceQuery` (HARD RULE 10's one buy-out): it is re-read every
 * time the search opens, and a bundle renamed a moment ago is cosmetic here where a stock count is not.
 */
export function useBundleSearch(args: { teamId: bigint | undefined; q: string; enabled?: boolean }) {
  const { teamId, q, enabled = true } = args;

  return useQuery({
    ...referenceQuery,
    queryKey: key.bundles(teamId, { search: q }),
    enabled: enabled && teamId !== undefined && teamId > 0n,
    queryFn: async () => {
      const res = await bundleClient.bundleList({
        teamId: teamId!,
        filter: { q },
        dataRequest: bundleListRowData(),
        page: { page: 1, limit: SEARCH_LIMIT },
      });

      return bundlesFromList(res.items, res.ids);
    },
  });
}

/** How many bundles the search offers at once — type to narrow past it. */
const SEARCH_LIMIT = 20;

/** One bundle of the team — `null` when the team holds no bundle by that id. */
export function useBundle(args: { teamId: bigint | undefined; bundleId: bigint }) {
  const { teamId, bundleId } = args;

  return useQuery({
    queryKey: key.bundles(teamId, { bundleId: bundleId.toString() }),
    enabled: teamId !== undefined && bundleId > 0n,
    queryFn: async () => {
      const res = await bundleClient.bundleByIds({
        teamId: teamId!,
        filter: { ids: [bundleId] },
        dataRequest: bundleByIdsRowData(),
      });

      return bundlesFromByIds(res).get(bundleId.toString()) ?? null;
    },
  });
}

// ProductByIds caps a call at 200 ids, and a page of bundles can name more — so the ids go in slices, in parallel.
const BY_IDS_MAX = 200;

/**
 * The products a set of bundle lines names — owner, lock and archive included, which is how a line knows it is
 * borrowed or unavailable (features/bundles/adapt.ts `lineState`). An archived product is still answered, so its line
 * can name it. Keyed by product id; an id that resolves to nothing is absent.
 */
export function useBundleProducts(args: { teamId: bigint | undefined; productIds: bigint[] }) {
  const { teamId } = args;
  const productIds = [...new Set(args.productIds.filter((id) => id > 0n))].sort();

  return useQuery({
    // Under `products`, not `bundles`: it IS the product read, and a product write must refresh it.
    queryKey: key.products(teamId, { bundleLines: productIds.map(String).join(",") }),
    enabled: teamId !== undefined && productIds.length > 0,
    queryFn: async () => {
      const slices: bigint[][] = [];
      for (let i = 0; i < productIds.length; i += BY_IDS_MAX) {
        slices.push(productIds.slice(i, i + BY_IDS_MAX));
      }

      const answers = await Promise.all(
        slices.map((ids) =>
          productClient.productByIds({ teamId: teamId!, filter: { ids }, dataRequest: productByIdsRowData() }),
        ),
      );

      return new Map<string, Product>(answers.flatMap((res) => productsFromByIds(res).map((p) => [p.id.toString(), p] as const)));
    },
  });
}

/**
 * What every warehouse holds of a bundle's products — one `StockAvailability` per warehouse, all the products at once.
 * Keyed by warehouse id, then by product id; a product a warehouse holds none of reads 0.
 *
 * EVERY warehouse, not only the one on screen: another team's product is refused below its owner's reserve, and the
 * reserve is tested against the product's total across every warehouse
 * (the-reserve-stops-other-teams-at-low-stock). OwnerStockByIds would total it in one call, but answers its owner only.
 */
export function useBundleStock(args: { teamId: bigint | undefined; productIds: bigint[]; warehouseIds: bigint[] }) {
  const { teamId } = args;
  const productIds = [...new Set(args.productIds.filter((id) => id > 0n))].sort();
  const warehouseIds = [...new Set(args.warehouseIds.filter((id) => id > 0n))].sort();

  return useQuery({
    // Under `inventory`: it is a stock read, and a stock movement must refresh it.
    queryKey: key.inventory(teamId, {
      bundleStock: productIds.map(String).join(","),
      warehouses: warehouseIds.map(String).join(","),
    }),
    enabled: teamId !== undefined && productIds.length > 0 && warehouseIds.length > 0,
    queryFn: async () => {
      const answers = await Promise.all(
        warehouseIds.map((warehouseId) => inventoryClient.stockAvailability({ teamId: teamId!, warehouseId, productIds })),
      );

      return new Map(
        warehouseIds.map((w, i) => [
          w.toString(),
          new Map(answers[i]!.items.map((it) => [it.productId.toString(), it.available] as const)),
        ]),
      );
    },
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────
//
// Only `bundles` is invalidated: a bundle is read by nothing else. The order form expands it into product lines at the
// moment of picking, and an order keeps no link back (the-order-keeps-only-product-lines).

export interface BundleFields {
  name: string;
  description: string;
  lines: BundleLineRecord[];
}

export function useInvalidateBundles() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["bundles"] });
}

/** Create a bundle, or replace an existing one's name, description and every line. */
export function useSaveBundle() {
  const invalidate = useInvalidateBundles();

  return useMutation({
    mutationFn: async (vars: { teamId: bigint; bundleId?: bigint; fields: BundleFields }): Promise<BundleRecord | null> => {
      const { teamId, bundleId, fields } = vars;
      const body = {
        teamId,
        name: fields.name.trim(),
        description: fields.description.trim(),
        lines: fields.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      };

      const res =
        bundleId === undefined
          ? await bundleClient.bundleCreate(body)
          : await bundleClient.bundleUpdate({ ...body, bundleId });

      return res.bundle ? bundleRecord(res.bundle) : null;
    },
    onSuccess: () => invalidate(),
  });
}

/** A HARD delete — no order refers to a bundle. */
export function useDeleteBundle() {
  const invalidate = useInvalidateBundles();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; bundleId: bigint }) => bundleClient.bundleDelete(vars),
    onSuccess: () => invalidate(),
  });
}
