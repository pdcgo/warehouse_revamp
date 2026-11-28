import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { inventoryClient } from "../../../api/clients";
import { key, listQuery } from "../../../api/queryClient";

// CETAK ULANG KODE'S READ AND ITS RECORDED PRINT (backlog #151, live since the-team-code-and-product-tags-prototype-is-
// accepted, row *the reprint*; products-have-their-own-tag-list, its 🔄 *what clears*). Both on InventoryService, the
// warehouse's own act: the read lists the products still waiting for THIS warehouse's new labels — each with its LIVE code,
// its former code and one label per shelf spot here — and the record clears this warehouse's wait for what the print
// carried; `need_reprint_code` comes off a product once the last holding warehouse has printed. The entry's (N) rides on
// the Products list's own read (useWarehouseStock `withReprint`), never a read of its own.

/** One label of the reprint — one shelf spot of this warehouse holding the product, with the product's LIVE code. */
export interface ReprintLabel {
  productId: bigint;
  productCode: string;
  name: string;
  placementCode: string;
  quantity: bigint;
}

/** One product waiting for this warehouse's reprint, its labels in spot order. */
export interface ReprintProduct {
  productId: bigint;
  productCode: string;
  name: string;
  /** The code it carried before — the sticker the new label replaces. Empty when none is recorded. */
  formerCode: string;
  labels: ReprintLabel[];
}

/** How many waiting products one read asks — the most a page asks (CommonPagination's cap). A print records its run's
 *  products, the read answers again, and the next ones come in. */
export const REPRINT_PAGE_SIZE = 200;

// `listQuery`: the read refines one question (this warehouse's waits) — after a print the rows stay up behind the
// RefreshOverlay while it answers again (HARD RULE 10). Keyed under the warehouse's `inventory`, so a record re-reads it
// with the Products list (its tags and its entry's count).
export function useProductReprint(warehouseId: bigint | undefined) {
  return useQuery({
    ...listQuery,
    queryKey: key.inventory(warehouseId, { reprint: true }),
    enabled: warehouseId !== undefined,
    queryFn: async () => {
      const res = await inventoryClient.productReprintList({ warehouseId: warehouseId!, page: { page: 1, limit: REPRINT_PAGE_SIZE } });

      const products: ReprintProduct[] = res.items.map((item) => ({
        productId: item.productId,
        productCode: item.productCode,
        name: item.name,
        formerCode: item.formerCode,
        labels: item.labels.map((label) => ({
          productId: item.productId,
          productCode: item.productCode,
          name: item.name,
          placementCode: label.placementCode,
          quantity: BigInt(label.quantity),
        })),
      }));

      return { products, totalProducts: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

/** What a recorded print did: this warehouse's waits cleared, the products whose code changed since the read (NOT
 *  cleared — printed again after the re-read), the products whose tag came off. */
export interface ReprintRecorded {
  cleared: bigint[];
  codeChanged: bigint[];
  untagged: bigint[];
}

// THE RECORDED PRINT — each product of the run with the code its labels carried. Settled either way, it re-reads the
// warehouse's `inventory` (this page, the Products list's rows, tags and entry) and its `products` (the product page's
// chips).
export function useRecordReprint(warehouseId: bigint | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (printed: { productId: bigint; productCode: string }[]): Promise<ReprintRecorded> => {
      const res = await inventoryClient.productReprintRecord({ warehouseId: warehouseId!, items: printed });

      return { cleared: res.clearedIds, codeChanged: res.codeChangedIds, untagged: res.untaggedIds };
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: key.inventory(warehouseId) }),
        client.invalidateQueries({ queryKey: key.products(warehouseId) }),
      ]),
  });
}
