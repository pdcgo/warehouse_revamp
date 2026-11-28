import { create } from "@bufbuild/protobuf";

import {
  ProductByIdsDataType,
  type ProductByIdsResponse,
  type ProductImage,
  ProductListDataType,
  type ProductListResponseItem,
  type Product,
  type ProductRowItem,
  ProductSchema,
} from "../../gen/warehouse/product/v1/product_pb";
import {
  type CostLayer,
  type DiscoverMovement,
  type DiscoverStockByIdsResponse,
  DiscoverStockHistoryDataType,
  type DiscoverStockHistoryResponse,
  OwnerBatchListDataType,
  type OwnerBatchListResponse,
  OwnerCostLayerListDataType,
  type OwnerCostLayerListResponse,
  type OwnerMovement,
  type OwnerStockByIdsResponse,
  OwnerStockHistoryDataType,
  type OwnerStockHistoryResponse,
  type ProductDailyMove,
  ProductDailyMovesDataType,
  type ProductDailyMovesResponse,
  type ProductSupplierGoods,
  ProductSupplierGoodsDataType,
  type ProductSupplierGoodsResponse,
  type StockBatch,
  type StockChangeType,
} from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { OrderProductActivityByIdsResponse } from "../../gen/warehouse/selling/v1/order_pb";
import type { ProductDerivedListResponse } from "../../gen/warehouse/selling/v1/return_configuration_pb";

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
    productCode: r.productCode,
    name: r.name,
    description: r.description,
    categoryId: r.categoryId,
    defaultImageUrl: r.defaultImageUrl,
    defaultImageThumbnailUrl: r.defaultImageThumbnailUrl,
    archived: r.archived,
    crossMarkupBps: r.crossMarkupBps,
    crossLocked: r.crossLocked,
    reservedStock: r.reservedStock,
    // Its tags — filled by ProductList only, the owning team's list (products-have-their-own-tag-list, 🔄 who sees); a
    // by-ids row carries none.
    tags: r.tags,
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
// THE GALLERY — the by-ids IMAGES slice, the discover detail's (the-discover-detail-shows-no-markup): another team's
// product's every picture, in order, the cover first. Asked alone, beside the record's own read.
export const productImagesData = (): ProductByIdsDataType[] => [ProductByIdsDataType.IMAGES];

/** One product's pictures from an IMAGES answer — empty when it has none, or when the product is absent. */
export function imagesFromByIds(res: ProductByIdsResponse, productId: bigint): ProductImage[] {
  const list = res.items[productId.toString()];

  for (const it of list?.items ?? []) {
    if (it.d.case === "images") return it.d.value.mapData[productId.toString()]?.items ?? [];
  }

  return [];
}

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
  readyValue: number;
  ongoingQty: bigint;
  ongoingValueEst: number;
  costMin: number;
  costMax: number;
  costKnown: boolean;
  oldestBatchUnix: bigint;
  lastRestockUnix: bigint;
  /**
   * On a warehouse transfer not yet accepted — the units and what the out-leg took (in-transit-is-its-own-figure-beside-
   * siap-and-dikirim); under a lens, those on their way TO that warehouse. Absent = the read did not say (a row built
   * without it, as a story's); the server always answers it, 0 included.
   */
  inTransitQty?: bigint;
  inTransitValue?: number;
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
        inTransitQty: row.inTransitQty,
        inTransitValue: row.inTransitValue,
      });
    }
  }

  return out;
}

// ── Discover's card figures (DiscoverStockByIds) ──────────────────────────────────────────────────────────────────────

/**
 * One product's figures on a Discover card, whoever owns it (a-discover-card-shows-its-stock,
 * discover-shows-the-cross-price): ready and on its way in the page's warehouse (every warehouse when none is picked),
 * the ready stock of EVERY warehouse that the lock badge reads (a-discover-card-says-locked-as-the-title-does), and the
 * cross price range — never the cost, which the server does not send. `cross` is absent when nothing is on a shelf.
 */
export interface DiscoverStockRow {
  readyQty: bigint;
  ongoingQty: bigint;
  totalReadyQty: bigint;
  cross?: { min: number; max: number };
}

export function discoverStockFromResponse(res: DiscoverStockByIdsResponse): Map<string, DiscoverStockRow> {
  return new Map(
    res.items.map((it) => [
      it.productId.toString(),
      {
        readyQty: it.readyQty,
        ongoingQty: it.ongoingQty,
        totalReadyQty: it.totalReadyQty,
        cross: it.crossKnown ? { min: it.crossMin, max: it.crossMax } : undefined,
      },
    ]),
  );
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

// ── The owner's ROW-level reads (#232) ──────────────────────────────────────────────────────────
//
// Three lists keyed by id in the guideline envelope, read back in the order `ids` gives — the server
// decided it (dearest layer first, newest delivery first, newest movement first) and re-sorting here
// would silently answer a different question from the one the paging is over.

// The data_request each of the three asks for. Fresh array per call — the field is mutable.
export const ownerLayerData = (): OwnerCostLayerListDataType[] => [OwnerCostLayerListDataType.LAYER];
export const ownerBatchData = (): OwnerBatchListDataType[] => [OwnerBatchListDataType.BATCH];
export const ownerMovementData = (): OwnerStockHistoryDataType[] => [OwnerStockHistoryDataType.MOVEMENT];
// ANY team's stock history of a product (stock-history-is-everyones) — the owner's units, nothing else of theirs.
export const discoverMovementData = (): DiscoverStockHistoryDataType[] => [DiscoverStockHistoryDataType.MOVEMENT];

export function layersFromList(res: OwnerCostLayerListResponse): CostLayer[] {
  const out: CostLayer[] = [];

  for (const it of res.items) {
    if (it.d.case !== "layer") continue;

    for (const id of res.ids) {
      const row = it.d.value.mapData[id.toString()];
      if (row) out.push(row);
    }
  }

  return out;
}

export function batchesFromList(res: OwnerBatchListResponse): StockBatch[] {
  const out: StockBatch[] = [];

  for (const it of res.items) {
    if (it.d.case !== "batch") continue;

    for (const id of res.ids) {
      const row = it.d.value.mapData[id.toString()];
      if (row) out.push(row);
    }
  }

  return out;
}

export function movementsFromList(res: OwnerStockHistoryResponse): OwnerMovement[] {
  const out: OwnerMovement[] = [];

  for (const it of res.items) {
    if (it.d.case !== "movement") continue;

    for (const id of res.ids) {
      const row = it.d.value.mapData[id.toString()];
      if (row) out.push(row);
    }
  }

  return out;
}

export function discoverMovementsFromList(res: DiscoverStockHistoryResponse): DiscoverMovement[] {
  const out: DiscoverMovement[] = [];

  for (const it of res.items) {
    if (it.d.case !== "movement") continue;

    for (const id of res.ids) {
      const row = it.d.value.mapData[id.toString()];
      if (row) out.push(row);
    }
  }

  return out;
}

// PEMASOK — who supplies a product (ProductSupplierGoods, the-supplier-tab-names-the-store): one row per supplier and
// the store it was bought at, newest delivery first, keyed by position.
export const productSupplierGoodsData = (): ProductSupplierGoodsDataType[] => [ProductSupplierGoodsDataType.GOODS];

/** One supplier at one of its stores, for one product. */
export interface ProductSupplierRow {
  /** The row's position in the whole list — a pair has no id of its own. */
  id: bigint;
  supplierId: bigint;
  /** 0n = lines that named the supplier and no store (a-line-with-no-store-links-under-the-supplier). */
  storeId: bigint;
  /** Kiriman — the accepted restocks that brought it. */
  deliveries: bigint;
  /** Unit — the good units they accepted. */
  units: bigint;
  lastDeliveryUnix: bigint;
  /** Modal terakhir — the newest delivery's batch unit cost; `undefined` whenever the server sent none, as it does for
   * every team but the owner. */
  lastUnitCost: number | undefined;
}

export function productSuppliersFromList(res: ProductSupplierGoodsResponse): ProductSupplierRow[] {
  const out: ProductSupplierRow[] = [];

  for (const it of res.items) {
    if (it.d.case !== "goods") continue;

    for (const id of res.ids) {
      const row: ProductSupplierGoods | undefined = it.d.value.mapData[id.toString()];
      if (!row) continue;

      out.push({
        id: row.id,
        supplierId: row.supplierId,
        storeId: row.storeId,
        deliveries: row.deliveries,
        units: row.units,
        lastDeliveryUnix: row.lastDeliveryUnix,
        lastUnitCost: row.lastUnitCost,
      });
    }
  }

  return out;
}

// KELUAR MASUK HARIAN — a product's last fourteen Jakarta days (ProductDailyMoves, the-warehouse-zone-is-tabs), today
// first, in the page's warehouse lens. Units only — the server sends nothing of the owner's money.
export const productDailyMovesData = (): ProductDailyMovesDataType[] => [ProductDailyMovesDataType.DAY];

/** One change type's net units on a day — signed: + in, − out. */
export interface DailyKind {
  changeType: StockChangeType;
  units: bigint;
}

/** One Jakarta day of a product, in the lens. */
export interface DailyRow {
  /** The Jakarta day, `yyyy-mm-dd`. */
  day: string;
  /** Masuk — ⚠ HELD (the owner's Q2): drawn as every change type whose net units that day are positive. */
  inQty: bigint;
  /** Keluar, a positive count — ⚠ HELD (the owner's Q2): every change type whose net units that day are negative. */
  outQty: bigint;
  /** Sisa — on hand at the end of the day. */
  onHand: bigint;
  /** Each change type that moved units that day, its net. */
  kinds: DailyKind[];
}

export function productDailyFromList(res: ProductDailyMovesResponse): DailyRow[] {
  const out: DailyRow[] = [];

  for (const it of res.items) {
    if (it.d.case !== "day") continue;

    for (const id of res.ids) {
      const d: ProductDailyMove | undefined = it.d.value.mapData[id.toString()];
      if (!d) continue;

      out.push({
        day: d.day,
        inQty: d.inUnits,
        outQty: d.outUnits,
        onHand: d.onHand,
        kinds: d.kinds.map((k) => ({ changeType: k.changeType, units: k.units })),
      });
    }
  }

  return out;
}

// ── Produk Turunan — the return map, both ways and across teams (produk-turunan-is-the-return-map) ──────────────────

/** One derived product as the Produk Turunan section draws it: a return map, named by the reads the page already makes. */
export interface DerivedProduct {
  productId: bigint;
  /** The product's name — `#<id>` when ProductByIds does not answer for it. */
  name: string;
  productCode: string;
  /** Turunan dari: the borrowed product's OWNER. Turunannya: the team whose map it is (it owns the product). */
  teamName: string;
  /** Its stock ready on a shelf, every warehouse — DiscoverStockByIds' figure, the Discover card's own. */
  readyQty: bigint;
  /** Its cover, for the Lihat Semua dialog — "" for none. */
  imageUrl: string;
}

export interface DerivedProducts {
  /** Turunan dari — the other teams' products this one was mapped FROM, newest first. Several can land on one. */
  from: DerivedProduct[];
  /** Turunannya — every team's own product mapped from this one, newest first. */
  to: DerivedProduct[];
  /** Each direction's whole count — the section's count, never short of a capped list. */
  fromTotal: number;
  toTotal: number;
}

/** Every product a product's maps name — what ProductByIds and DiscoverStockByIds are asked about, each id once. */
export function derivedProductIds(maps: ProductDerivedListResponse): bigint[] {
  const ids = [...maps.derivedFrom.map((m) => m.sharedProductId), ...maps.derivedTo.map((m) => m.ownProductId)];

  return [...new Set(ids.map(String))].sort().map((id) => BigInt(id));
}

/** The maps named: each line's product from `products`, its team's name from `teams`, its ready stock from `stock`. */
export function derivedFromMaps(
  maps: ProductDerivedListResponse,
  products: Map<string, Product>,
  stock: Map<string, DiscoverStockRow>,
  teams: { [id: string]: string },
): DerivedProducts {
  const teamName = (teamId: bigint) => teams[teamId.toString()] ?? (teamId > 0n ? `#${teamId}` : "—");
  const line = (productId: bigint, teamId: bigint): DerivedProduct => {
    const p = products.get(productId.toString());

    return {
      productId,
      name: p?.name ?? `#${productId}`,
      productCode: p?.productCode ?? "",
      teamName: teamName(teamId),
      readyQty: stock.get(productId.toString())?.readyQty ?? 0n,
      imageUrl: p ? p.defaultImageThumbnailUrl || p.defaultImageUrl : "",
    };
  };

  return {
    // The other team's product — named by ITS owner, which only its record says.
    from: maps.derivedFrom.map((m) => line(m.sharedProductId, products.get(m.sharedProductId.toString())?.teamId ?? 0n)),
    // The map's team owns the product it maps to (the write refuses anything else).
    to: maps.derivedTo.map((m) => line(m.ownProductId, m.teamId)),
    fromTotal: Number(maps.derivedFromTotal),
    toTotal: Number(maps.derivedToTotal),
  };
}
