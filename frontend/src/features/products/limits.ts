// THE PRODUCT'S LIMITS, as the server checks them — mirrored from the `buf.validate` rules on ProductCreateRequest /
// ProductUpdateRequest in proto/warehouse/product/v1/product.proto. The form gives each to its field (`maxLength` and the
// count under it, a-limited-field-shows-its-count), so a value the server would refuse cannot be typed in the first place.
// Change one here only together with the proto.
export const PRODUCT_LIMITS = {
  /** `sku` — string max_len 64. */
  sku: 64,
  /** `name` — string max_len 200. */
  name: 200,
  /** `description` — string max_len 1000. */
  description: 1000,
  /** `reserved_stock` — uint32 lte 1000000. */
  reservedStock: 1_000_000,
} as const;
