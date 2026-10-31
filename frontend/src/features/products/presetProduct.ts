import { useSearchParams } from "react-router-dom";

import { useProductsByIds } from "./queries";

// A FORM OPENED FROM A PRODUCT'S PAGE, WITH THAT PRODUCT ON IT (owner: *"bagaimana cara untuk membuat order dan restok
// langsung di detail ini"*, then *"oke"* to opening the existing forms, a-product-page-opens-the-order-and-restock-forms).
// The product's page asks the warehouse and the quantity first (StartFormDialog, the-order-and-restock-start-on-the-page),
// then links to the order or restock form with `?product=<id>&warehouse=<id>&qty=<n>` — an order ships from, and a
// restock lands in, exactly one warehouse. The form reads them here and starts with that product as its first line, at
// that quantity; everything else is the form's own, checks included.
//
// The product comes from ProductByIds, which answers whoever owns it — the discover detail opens the order form for
// ANOTHER team's product, a borrowed line.

/** The order form, with this product on it — and this warehouse and quantity, when they were chosen. */
export function orderFormFor(productId: bigint, warehouseId = 0n, quantity = 0): string {
  return `/orders/new?${presetQuery(productId, warehouseId, quantity)}`;
}

/** The restock form, with this product on it — and this warehouse and quantity, when they were chosen. */
export function restockFormFor(productId: bigint, warehouseId = 0n, quantity = 0): string {
  return `/inventories/restock/new?${presetQuery(productId, warehouseId, quantity)}`;
}

function presetQuery(productId: bigint, warehouseId: bigint, quantity: number): string {
  const q = new URLSearchParams({ product: productId.toString() });
  if (warehouseId > 0n) q.set("warehouse", warehouseId.toString());
  if (quantity > 0) q.set("qty", String(quantity));
  return q.toString();
}

function idOf(raw: string | null): bigint {
  return raw !== null && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

/**
 * The product and warehouse a form was opened with — 0n when none — and the line's quantity as the form holds it, a
 * string ("1" when none was chosen). `product` is the record once it has loaded (its SKU, name and cover for the line),
 * undefined before that or when the id names nothing.
 */
export function usePresetProduct(teamId: bigint | undefined) {
  const [searchParams] = useSearchParams();
  const productId = idOf(searchParams.get("product"));
  const warehouseId = idOf(searchParams.get("warehouse"));
  const qty = idOf(searchParams.get("qty"));
  const query = useProductsByIds({ teamId, productIds: productId > 0n ? [productId] : [] });

  return {
    productId,
    warehouseId,
    quantity: qty > 0n ? qty.toString() : "1",
    product: query.data?.get(productId.toString()),
  };
}
