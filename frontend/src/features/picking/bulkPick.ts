import type { StockPickLocation } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { OrderPick as OrderPickRow } from "../../gen/warehouse/selling/v1/order_pb";

// THE BULK PICK LIST (the-bulk-pick-list-prototype-is-accepted, acceptance inventory/order.md — *bulk pick order*): the
// ticked Dikonfirmasi orders' goods in ONE walk, read two ways — each product with its total and its racks, or each order
// with its products and racks. A READ: no status moves (the orders stay processed), and the racks are the ones the takes
// already drew from, as on the single pick page (the-placement-page-reads-racks-by-transaction-id). The list names the
// rack; nobody confirms it (a-wrong-rack-pick-waits-for-the-count).
//
// THE CONTRACT — two reads for the page's ids, then the shops' names (useBulkPick, features/picking/queries.ts):
//
//   selling   OrderService.OrderPickLines { team_id: the warehouse, order_ids: 1–50 }
//               → orders: OrderPick { order_id, transaction_id, status, shop_id, order_external_ref_id,
//                                     shipment_channel_id, receipt_code, lines: { product_id, product_code, name,
//                                     quantity }, reprint_label }
//             only the orders that SHIP FROM the warehouse, in the asked order; another building's, or no such order,
//             is absent. No money.
//   inventory InventoryService.StockPickLocations { warehouse_id, transaction_ids: 1–50 }   (the single pick page
//             keeps `transaction_id`, one take — exactly one of the two)
//               → locations: { transaction_id, product_id, rack_id, rack_code, quantity }
//             ONE query (`transaction_id IN … AND warehouse_id = …`, netted per take), ordered take → product → rack; a
//             take of another building adds nothing.
//   selling   ShopService.ShopByIds — each order's shop name and marketplace, as the warehouse list labels its rows.
//
// Both caps are 50 — the warehouse list's largest page, so one tick of its head fills it (BULK_PICK_MAX).

/** One ticked order, as the page holds it after its reads. */
export interface BulkPickOrder {
  id: bigint;
  /** The take's inventory transaction — what the racks are read by (the-placement-page-reads-racks-by-transaction-id). */
  transactionId: bigint;
  shopName: string;
  marketplace: Marketplace;
  orderExternalRefId: string;
  shipmentChannelId: bigint;
  /** The resi; "" when nobody recorded one. */
  receiptCode: string;
  /**
   * CETAK ULANG LABEL — the seller changed the resi or label after it was printed (OrderPick.reprint_label,
   * a-changed-label-asks-the-warehouse-to-reprint): the order's block carries the badge, as the list's row does.
   */
  reprintLabel: boolean;
  /** The order's lines — what to fetch. */
  lines: BulkPickLine[];
}

export interface BulkPickLine {
  productId: bigint;
  name: string;
  productCode: string;
  quantity: number;
}

/** One row of the many-take StockPickLocations answer — a rack of one take (see the head of this file). */
export interface BulkPickLocation {
  transactionId: bigint;
  productId: bigint;
  /** 0 = unplaced. */
  rackId: bigint;
  rackCode: string;
  quantity: bigint;
}

/** Everything the page reads for its ids — the orders, in the order they were ticked, and their takes' racks. */
export interface BulkPickAnswer {
  orders: BulkPickOrder[];
  locations: BulkPickLocation[];
}

/** A shop's label, as ShopByIds answers it (features/shops ShopNames). */
export interface BulkPickShop {
  name: string;
  marketplace: Marketplace;
}

/**
 * THE PAGE'S ANSWER from its reads: each order OrderPickLines answered (in the asked order, its shop labelled from
 * ShopByIds — "" until the names land), and every location StockPickLocations answered for their takes.
 */
export function bulkPickAnswerOf(
  orders: readonly OrderPickRow[],
  locations: readonly StockPickLocation[],
  shops: ReadonlyMap<string, BulkPickShop>,
): BulkPickAnswer {
  return {
    orders: orders.map((order) => {
      const shop = shops.get(order.shopId.toString());

      return {
        id: order.orderId,
        transactionId: order.transactionId,
        shopName: shop?.name ?? "",
        marketplace: shop?.marketplace ?? Marketplace.UNSPECIFIED,
        orderExternalRefId: order.orderExternalRefId,
        shipmentChannelId: order.shipmentChannelId,
        receiptCode: order.receiptCode,
        reprintLabel: order.reprintLabel,
        lines: order.lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          productCode: line.productCode,
          quantity: line.quantity,
        })),
      };
    }),
    locations: locations.map((loc) => ({
      transactionId: loc.transactionId,
      productId: loc.productId,
      rackId: loc.rackId,
      rackCode: loc.rackCode,
      quantity: loc.quantity,
    })),
  };
}

/** One rack to walk to, and how many to take from it. */
export interface PickRack {
  /** 0 = unplaced. */
  rackId: bigint;
  rackCode: string;
  quantity: number;
}

/** PER PRODUK — one product across every ticked order. */
export interface ProductPick {
  productId: bigint;
  name: string;
  productCode: string;
  /** Every unit of it the ticked orders hold. */
  total: number;
  /** Each rack once, its units summed over the orders; placed racks by code, then the unplaced pile. */
  racks: PickRack[];
  /** Units no take recorded a rack for (an order placed before stock was integrated, #149). */
  unrecorded: number;
  /** How many of the ticked orders want it. */
  orderCount: number;
}

/** One line of PER PESANAN — a product of one order, with its own racks. */
export interface OrderPickLine {
  productId: bigint;
  name: string;
  productCode: string;
  quantity: number;
  racks: PickRack[];
  unrecorded: number;
}

/** PER PESANAN — one ticked order with its products and racks. */
export interface OrderPick {
  order: BulkPickOrder;
  lines: OrderPickLine[];
  units: number;
}

/** At most 50 orders a list — the warehouse list's largest page (one tick of its head), and both reads' cap. */
export const BULK_PICK_MAX = 50;

/** The page's one address: `/warehouse-orders/bulk-pick?ids=103,104`, read back as its orders, in that order. */
export function bulkPickPath(ids: bigint[]): string {
  return `/warehouse-orders/bulk-pick?ids=${ids.join(",")}`;
}

/** The address's ids: every whole number once, in order, at most BULK_PICK_MAX. */
export function bulkPickIdsOf(search: string): bigint[] {
  const ids: bigint[] = [];

  for (const part of (new URLSearchParams(search).get("ids") ?? "").split(",")) {
    if (ids.length >= BULK_PICK_MAX) break;
    const p = part.trim();
    if (!/^\d+$/.test(p)) continue;
    const id = BigInt(p);
    if (id > 0n && !ids.includes(id)) ids.push(id);
  }

  return ids;
}

/** Placed racks by their code (A-01-2 before A-01-10), the unplaced pile after them — the walk, then the pile. */
function sortRacks(racks: PickRack[]): PickRack[] {
  return [...racks].sort((a, b) => {
    if ((a.rackId === 0n) !== (b.rackId === 0n)) return a.rackId === 0n ? 1 : -1;
    return a.rackCode.localeCompare(b.rackCode, undefined, { numeric: true });
  });
}

/** Racks summed by rack id. */
function mergeRacks(into: PickRack[], more: PickRack[]): PickRack[] {
  const out = into.map((rack) => ({ ...rack }));

  for (const rack of more) {
    const same = out.find((r) => r.rackId === rack.rackId);
    if (same) same.quantity += rack.quantity;
    else out.push({ ...rack });
  }

  return sortRacks(out);
}

/** Where to start walking for it: its first placed rack's code; undefined when it sits on no rack. */
function walkKey(racks: PickRack[]): string | undefined {
  return racks.find((rack) => rack.rackId !== 0n)?.rackCode;
}

/** Walk order: by the first placed rack, a product on no rack after every placed one, ties by name. */
function byWalk(a: ProductPick, b: ProductPick): number {
  const ka = walkKey(a.racks);
  const kb = walkKey(b.racks);

  if (ka === undefined || kb === undefined) {
    if (ka !== kb) return ka === undefined ? 1 : -1;
    return a.name.localeCompare(b.name);
  }

  return ka.localeCompare(kb, undefined, { numeric: true }) || a.name.localeCompare(b.name);
}

/**
 * PER PESANAN — each order with its products and the racks ITS take drew each from. A product on two lines of one order
 * is one line (its quantities summed). Units the take recorded no rack for are `unrecorded`, never left silent.
 */
export function groupByOrder(answer: BulkPickAnswer): OrderPick[] {
  return answer.orders.map((order) => {
    const lines: OrderPickLine[] = [];

    for (const line of order.lines) {
      const same = lines.find((l) => l.productId === line.productId);
      if (same) same.quantity += line.quantity;
      else lines.push({ ...line, racks: [], unrecorded: 0 });
    }

    for (const line of lines) {
      const drawn = answer.locations
        .filter((loc) => loc.transactionId === order.transactionId && loc.productId === line.productId)
        .map((loc) => ({ rackId: loc.rackId, rackCode: loc.rackCode, quantity: Number(loc.quantity) }));

      line.racks = mergeRacks([], drawn);
      const located = line.racks.reduce((n, rack) => n + rack.quantity, 0);
      line.unrecorded = Math.max(0, line.quantity - located);
    }

    return { order, lines, units: lines.reduce((n, line) => n + line.quantity, 0) };
  });
}

/**
 * PER PRODUK — each product once, its total over every ticked order, and each rack once with its units summed. Listed in
 * WALK ORDER: by the product's first placed rack (A-01-1 before B-02-1), so the list reads as one trip down the aisles;
 * a product with no placed rack goes last, ties by name.
 */
export function groupByProduct(answer: BulkPickAnswer): ProductPick[] {
  const byId = new Map<string, ProductPick>();

  for (const { lines } of groupByOrder(answer)) {
    for (const line of lines) {
      const key = line.productId.toString();
      const seen = byId.get(key);

      if (!seen) {
        byId.set(key, {
          productId: line.productId,
          name: line.name,
          productCode: line.productCode,
          total: line.quantity,
          racks: line.racks,
          unrecorded: line.unrecorded,
          orderCount: 1,
        });
        continue;
      }

      seen.total += line.quantity;
      seen.racks = mergeRacks(seen.racks, line.racks);
      seen.unrecorded += line.unrecorded;
      seen.orderCount += 1;
    }
  }

  return [...byId.values()].sort(byWalk);
}
