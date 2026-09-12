import { HStack } from "@chakra-ui/react";
import { RefIdBadge } from "../badges/RefIdBadge";
import { Image } from "../display/Image";
import { EntityCell } from "./EntityCell";

// The minimum a ProductCell needs. Deliberately loose rather than the generated `Product` message:
// several RPCs return trimmed product shapes (a picking line, a settlement row, an order item), and
// requiring the full message would force every caller to construct fields the cell never reads.
export interface ProductCellData {
  id?: bigint | number;
  name?: string;
  refId?: string;
  image?: string;
}

// ProductCell is how a product appears in a table row: its photo, its name, and its SKU.
//
// The SKU is not decoration. A product's NAME is frequently ambiguous — "Kaos Polos Hitam" exists in
// four sizes with near-identical names — so the ref id is what actually identifies the row, and
// making it click-to-copy is what saves retyping it into a marketplace form. That is why the badge
// is part of the standard cell rather than an extra column some screens remember to add.
//
// ⚠ PRESENTATIONAL: it takes a resolved product, it does not fetch one. A table of 50 rows resolves
// its products with ONE `useProductsByIds` call at the page level and passes each down — 50 cells
// each fetching their own product is the N+1 this shape exists to prevent.
export const description =
  "A product in a table row: photo, clipping name, and a click-to-copy SKU badge. Takes a resolved product — the page batches the lookup with useProductsByIds.";

export interface ProductCellProps {
  product?: ProductCellData;
  // The id to fall back to when the product could not be resolved.
  productId?: bigint | number;
  loading?: boolean;
}

export function ProductCell({ product, productId, loading }: ProductCellProps) {
  const id = product?.id ?? productId;

  return (
    <EntityCell
      loading={loading && !product}
      media={
        <Image
          src={product?.image}
          alt={product?.name}
          boxSize="10"
          borderRadius="l2"
          flexShrink="0"
          preview
        />
      }
      name={product?.name}
      fallback={id !== undefined ? `#${id}` : undefined}
      secondary={
        product?.refId ? (
          <HStack gap="1">
            <RefIdBadge refId={product.refId} />
          </HStack>
        ) : undefined
      }
    />
  );
}
