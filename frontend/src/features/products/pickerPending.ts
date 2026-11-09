import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE PRODUCT PICKER CANNOT DO YET — shared by every screen that picks with it (ProductSelect), so its mark sits in
// the picker itself, where the gap shows: in the panel that opens empty.

export type ProductPickerPendingId = "warehouseOpensEmpty";

const PARTS: PendingPart<ProductPickerPendingId>[] = [
  // ⚠ A WAREHOUSE'S PICKER OPENS EMPTY (a-product-picker-needs-no-two-letters): every product picker opens on its first page
  // and searches from one letter — but a warehouse's search (WarehouseProductSearch: Temuan, a count's product plan and its
  // found) still refuses fewer than two characters, so until two are typed the panel says so instead of listing.
  // `missing`: the first page is not on screen at all.
  { id: "warehouseOpensEmpty", kind: "missing" },
];

/** What the product picker's mark reads. */
export const PRODUCT_PICKER_PENDING: PendingList<ProductPickerPendingId> = { ns: "products.picker", parts: PARTS };
