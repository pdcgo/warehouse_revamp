import { Flex, Stack, Text } from "@chakra-ui/react";

import type { OrderItem } from "../../../gen/warehouse/selling/v1/order_pb";
import { ProductListItem } from "../../../components/products/ProductListItem";
import type { ProductListItemProps } from "../../../components/products/ProductListItem";
import { lineTotalBeli, lineUnitBeli } from "../../../features/orders/margin";
import { formatRupiah } from "../../../lib/money";

/** The catalogue's cover for a line's product, from the page's ONE batched `ProductByIds` (`useProductsByIds`). */
type Covers = ReadonlyMap<string, { defaultImageUrl?: string; defaultImageThumbnailUrl?: string }> | undefined;

/**
 * A line's product as `ProductListItem` draws it: the LINE's sku and name — what was ordered, frozen on the order — and the
 * catalogue's picture from the batched lookup. While that read is in flight, or for a product it does not answer for,
 * there is no picture and the component draws its placeholder: the line reads exactly as it did without the lookup.
 */
export function lineProductOf(item: OrderItem, covers: Covers): ProductListItemProps["product"] {
  const product = covers?.get(item.productId.toString());

  return {
    id: item.productId,
    productCode: item.productCode,
    name: item.name,
    defaultImageUrl: product?.defaultImageUrl,
    defaultImageThumbnailUrl: product?.defaultImageThumbnailUrl,
  };
}

// ⚠ A PHONE GETS ONE BLOCK PER LINE, NOT THE TABLE (owner: *"product itemsnya kepotong-potong karena terlalu sempit"*,
// a-phone-reads-each-line-as-a-block). Five columns in 360px clamped both product names to a word each, and the qty and
// line total sat off the edge in the scroll box. Here each name gets the full width and the arithmetic reads as a
// sentence: harga beli × qty = line total.
//
//   [▣] Kaos Polos Hitam — M
//       KPH-M
//   Rp 48.000 × 2 · Toko Melati ……………… Rp 96.000
//
// BOTH ENDS OF THE ORDER DRAW IT — the seller's page of sections and the warehouse's Info tab — so a line reads the same
// whichever team opens the order. Each page keeps its own test ids (`testId`, `itemTestId`), and the team after the qty
// only where the page names it (`teamName`).
export function ItemBlocks({
  items,
  productOf,
  teamName,
  testId,
  itemTestId,
}: {
  items: OrderItem[];
  /** The line's product for `ProductListItem` — `lineProductOf` with the page's covers. */
  productOf: (item: OrderItem) => ProductListItemProps["product"];
  /** The selling team, after the qty (`× 2 · Toko Melati`) — left out when empty. */
  teamName?: string;
  /** The list's test id. */
  testId: string;
  /** One block's test id — the page's own, as its desktop row carries it. */
  itemTestId: (item: OrderItem) => string;
}) {
  return (
    <Stack gap="0" data-testid={testId}>
      {items.map((item, index) => (
        <Stack
          key={item.id.toString()}
          gap="2"
          py="3"
          borderTopWidth={index === 0 ? "0" : "1px"}
          borderColor="border"
          data-testid={itemTestId(item)}
        >
          <ProductListItem product={productOf(item)} />
          <Flex justify="space-between" align="baseline" gap="3" fontSize="sm">
            <Text color="fg.muted">
              {item.unitCost > 0 ? formatRupiah(lineUnitBeli(item)) : "—"} × {item.quantity}
              {teamName ? ` · ${teamName}` : ""}
            </Text>
            <Text fontWeight="bold" whiteSpace="nowrap">
              {item.unitCost > 0 ? formatRupiah(lineTotalBeli(item)) : "—"}
            </Text>
          </Flex>
        </Stack>
      ))}
    </Stack>
  );
}
