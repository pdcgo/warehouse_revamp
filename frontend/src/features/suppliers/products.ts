import { useQuery } from "@tanstack/react-query";
import { supplierChannelClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { SupplierProduct, SupplierProductListResponse } from "../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { SupplierChannelRecord } from "./adapt";
import type { SupplierFigureValues } from "./figureValues";

// A SUPPLIER'S PRODUCTS, REAL (SupplierChannelService.SupplierProductList) — the Produk tab on the manage detail and on
// the Discover detail alike (`supplier-detail-has-channels-and-products-tabs`): one row per product per store it was
// bought at (`products-hang-off-a-channel`), or bought with NO store — its Toko cell reads "—"
// (`a-line-with-no-store-links-under-the-supplier`). Searched, narrowed by team and store and paged ON THE SERVER, newest
// restock first (`the-products-tab-searches-and-pages`, `the-products-tab-filters-by-team-and-store`); each row named by
// product_service and carrying its store × product Terjual and Siap from inventory (`the-detail-tabs-show-sold-and-ready`).
//
// Every selling team reads the same rows and figures — the team that keeps the supplier, and any other on Discover
// (`another-team-sees-everything-of-a-supplier`, `every-selling-team-sees-every-teams-figures`). Nothing here is money.

/** The store filter's "bought with no store" — never a store id (ids are positive). */
export const NO_STORE = -1n;

/** One row of the Produk tab. */
export interface SupplierProductRow {
  /** The link's id — the row's key; one product bought at two stores is two rows. */
  id: bigint;
  /** The product as the app draws a product everywhere — its picture, its name, its SKU under it. */
  product: { id: bigint; name: string; productCode: string; defaultImageThumbnailUrl: string };
  /** Whose product it is — the restocking team. */
  teamId: bigint;
  /** The store it was bought at; null = no store, the cell reads "—". */
  store: SupplierChannelRecord | null;
  /** The first and the last restock that named it, unix seconds (`a-link-remembers-its-last-restock`). */
  firstBoughtAt: bigint;
  lastBoughtAt: bigint;
  /** Its Terjual and Siap — no restock date: *Terakhir dibeli* is that date. null = none of its goods arrived. */
  figures: SupplierFigureValues | null;
}

function rowOf(p: SupplierProduct, supplierId: bigint): SupplierProductRow {
  return {
    id: p.id,
    product: {
      id: p.productId,
      // An unresolved product keeps its id, as the export's cell does.
      name: p.productName || `#${p.productId}`,
      productCode: p.productCode,
      defaultImageThumbnailUrl: p.productThumbnailUrl,
    },
    teamId: p.teamId,
    store:
      p.channelId > 0n
        ? { id: p.channelId, supplierId, channelType: p.channelType, name: p.channelName, uri: "", description: "" }
        : null,
    firstBoughtAt: p.firstRestockedUnix,
    lastBoughtAt: p.lastRestockedUnix,
    figures: p.figures
      ? {
          sold: Number(p.figures.soldUnits),
          orders: Number(p.figures.orders),
          lastOrderAt: p.figures.lastOrderUnix,
          ready: Number(p.figures.readyUnits),
        }
      : null,
  };
}

/** The page's rows in the server's order — the response's `ids`, each looked up in its product map. */
export function productRowsOf(res: SupplierProductListResponse, supplierId: bigint): SupplierProductRow[] {
  const byId = new Map<string, SupplierProduct>();
  for (const item of res.items) {
    if (item.d.case !== "product") continue;
    for (const [id, row] of Object.entries(item.d.value.mapData)) byId.set(id, row);
  }

  return res.ids.flatMap((id) => {
    const row = byId.get(id.toString());
    return row ? [rowOf(row, supplierId)] : [];
  });
}

/**
 * The tab's filter as the server takes it — the store pick split into one store or no store, and the page's Gudang terkait
 * chip (`a-supplier-page-is-scoped-by-its-warehouses`, 0n = every warehouse).
 */
export function productFilter(args: { supplierId: bigint; q: string; teamId: bigint; storeId: bigint; warehouseId?: bigint }) {
  return {
    supplierId: args.supplierId,
    q: args.q,
    productTeamId: args.teamId,
    storeId: args.storeId > 0n ? args.storeId : 0n,
    noStore: args.storeId === NO_STORE,
    warehouseId: args.warehouseId ?? 0n,
  };
}

/**
 * ONE PAGE of a supplier's products, searched and narrowed ON THE SERVER. `teamId` is the CALLER's scope; `productTeamId`
 * is the Tim filter (0n = every team); `storeId` the Toko filter (0n = every store, NO_STORE = bought with no store);
 * `warehouseId` the page's Gudang terkait chip — only the rows with goods received there, with that warehouse's Terjual
 * and Siap (0n = every warehouse).
 */
export function useSupplierProductPage(args: {
  teamId: bigint | undefined;
  supplierId: bigint;
  q: string;
  productTeamId: bigint;
  storeId: bigint;
  warehouseId?: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, supplierId, q, productTeamId, storeId, page, pageSize } = args;
  const warehouseId = args.warehouseId ?? 0n;

  return useQuery({
    // A search, a filter and a page refine the same question (HARD RULE 10) — the browser keeps the rows up behind
    // its RefreshOverlay while the next answer loads.
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      supplierId: supplierId.toString(),
      productsPaged: true,
      q,
      productTeamId: productTeamId.toString(),
      storeId: storeId.toString(),
      warehouseId: warehouseId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && teamId > 0n && supplierId > 0n,
    queryFn: async () => {
      const res = await supplierChannelClient.supplierProductList({
        teamId: teamId!,
        filter: productFilter({ supplierId, q, teamId: productTeamId, storeId, warehouseId }),
        page: { page, limit: pageSize },
      });

      return {
        rows: productRowsOf(res, supplierId),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}
