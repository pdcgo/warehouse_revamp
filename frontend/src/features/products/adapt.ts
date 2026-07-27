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
import type { OwnerStockByIdsResponse } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { OrderProductActivityByIdsResponse } from "../../gen/warehouse/selling/v1/order_pb";

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
    crossMarkupBps: r.crossMarkupBps,
    crossLocked: r.crossLocked,
    reservedStock: r.reservedStock,
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

// ── The two by-ids reads behind the product list's stock columns ─────────────────────────────────
//
// Both follow the guideline by-ids envelope — a map of product id → a list of slices — and both are
// flattened here, at the query boundary, so no screen ever has to walk a oneof to read a number.

// One product's stock facts, as the LIST renders them.
export interface OwnerStockRow {
  readyQty: bigint;
  readyValue: bigint;
  ongoingQty: bigint;
  ongoingValueEst: bigint;
  costMin: bigint;
  costMax: bigint;
  costKnown: boolean;
  oldestBatchUnix: bigint;
  lastRestockUnix: bigint;
}

export function ownerStockFromByIds(res: OwnerStockByIdsResponse): Map<string, OwnerStockRow> {
  const out = new Map<string, OwnerStockRow>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case !== "stock") continue;

      const row = it.d.value.mapData[id];
      if (!row) continue;

      out.set(id, {
        readyQty: row.readyQty,
        readyValue: row.readyValue,
        ongoingQty: row.ongoingQty,
        ongoingValueEst: row.ongoingValueEst,
        costMin: row.costMin,
        costMax: row.costMax,
        costKnown: row.costKnown,
        oldestBatchUnix: row.oldestBatchUnix,
        lastRestockUnix: row.lastRestockUnix,
      });
    }
  }

  return out;
}

// One product's selling activity.
export interface ProductActivityRow {
  lastOrderUnix: bigint;
  soldQty30d: bigint;
}

export function activityFromByIds(res: OrderProductActivityByIdsResponse): Map<string, ProductActivityRow> {
  const out = new Map<string, ProductActivityRow>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case !== "activity") continue;

      const row = it.d.value.mapData[id];
      if (!row) continue;

      out.set(id, { lastOrderUnix: row.lastOrderUnix, soldQty30d: row.soldQty30d });
    }
  }

  return out;
}
