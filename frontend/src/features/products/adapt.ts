import { create } from "@bufbuild/protobuf";

import {
  ProductByIdsDataType,
  type ProductByIdsResponse,
  ProductListDataType,
  type ProductListResponseItem,
  type Product,
  type ProductRowItem,
  ProductSchema,
} from "../../gen/warehouse/product/v1/product_pb";

// The guideline list/by-ids RPCs (guidelines/service-guideline.md) return per-id "slices" keyed by
// product id, plus a sorted `ids` list, instead of a flat Product[]. The product screens still want
// plain Product objects, so these adapters live at the query boundary: they ask for the PRODUCT (row)
// slice and rebuild Product from it, keeping every downstream component unchanged.

// The data_request that asks for the full PRODUCT row (fresh array per call — the field is mutable).
export const productListRowData = (): ProductListDataType[] => [ProductListDataType.PRODUCT];
export const productByIdsRowData = (): ProductByIdsDataType[] => [ProductByIdsDataType.PRODUCT];

function rowToProduct(r: ProductRowItem): Product {
  // create() fills the rest (images: []) — a list/by-ids row never carries the gallery.
  return create(ProductSchema, {
    id: r.id,
    teamId: r.teamId,
    sku: r.sku,
    name: r.name,
    description: r.description,
    categoryId: r.categoryId,
    defaultImageUrl: r.defaultImageUrl,
    defaultImageThumbnailUrl: r.defaultImageThumbnailUrl,
    deleted: r.deleted,
  });
}

function rowMap(items: ProductListResponseItem[]): Map<string, Product> {
  const out = new Map<string, Product>();

  for (const it of items) {
    if (it.d.case === "product") {
      for (const [id, row] of Object.entries(it.d.value.mapData)) {
        out.set(id, rowToProduct(row));
      }
    }
  }

  return out;
}

// productsFromList rebuilds Product[] from a list response, in the response's sorted id order.
export function productsFromList(items: ProductListResponseItem[], ids: bigint[]): Product[] {
  const rows = rowMap(items);
  const out: Product[] = [];

  for (const id of ids) {
    const p = rows.get(id.toString());
    if (p) out.push(p);
  }

  return out;
}

// productsFromByIds rebuilds Product[] from a by-ids response. Unordered — match by id.
export function productsFromByIds(res: ProductByIdsResponse): Product[] {
  const out: Product[] = [];

  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "product") {
        const row = it.d.value.mapData[id];
        if (row) out.push(rowToProduct(row));
      }
    }
  }

  return out;
}
