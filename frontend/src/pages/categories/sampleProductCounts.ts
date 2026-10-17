// ⚠ SAMPLE — AN INVENTED FIGURE for how many products a category holds (owner: *"tambah jumlah produk dan kasih
// warning"*). The page marks it `sample` (pending.ts). The real figure needs the product service to count what is filed
// under a node — ProductList has no category filter, and a product filed under several nodes
// (a-product-files-under-many-categories) is decided but not built. Deleted the day that count exists.
//
// The same figure every render for the same category, so a story can assert on it.
export function sampleProductCount(categoryId: bigint): number {
  const n = Number(categoryId % 997n);
  return (n * 37) % 7 === 0 ? 0 : 3 + ((n * 389) % 140);
}
