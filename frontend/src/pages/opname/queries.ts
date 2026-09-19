import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { inventoryClient, productClient, rackClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { UNPLACED } from "../../components/pickers/RackSelect";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { StockOpnameLine } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { rackStockFromList, rackStockRowData } from "../../features/racks/adapt";

// A whole shelf is a handful of products, not a page of them. The count screen shows ALL of it or it
// is not a stock-take — a counter who has to turn a page will forget the second one, and the lines
// they never send are the lines that stay uncounted (which is the safe outcome, but a silent one).
//
// 200 is the ceiling the server's own `max_items: 500` leaves room under. If a shelf ever genuinely
// holds more, the screen must say so rather than quietly counting the first page — see `truncated`.
const SHELF_PAGE = { page: 1, limit: 200 } as const;

// ONE LINE OF THE COUNT: what the system believes, and what the person typed.
export interface CountRow {
  productId: bigint;
  sku: string;
  name: string;
  /** What the system believes is on this shelf. */
  expected: bigint;
  /** What one unit cost this warehouse — 0 when never recorded (`costKnown` carries the difference). */
  unitCost: bigint;
  costKnown: boolean;
}

export interface ShelfContents {
  rows: CountRow[];
  /** True when the shelf holds more products than one screen loaded — the count would be incomplete. */
  truncated: boolean;
}

// What the system thinks is on one shelf — the sheet the counter walks up to.
//
// Two calls, and the second is not optional: `RackStock` returns product IDS ONLY, because a warehouse
// holds OTHER TEAMS' goods and their names live in those teams' catalogues. Resolving them through
// `ProductByIds` (never `ProductList`, which serves this warehouse's own catalogue and would silently
// omit most of the shelf) is what makes the sheet readable by a person.
export function useShelfContents(args: { warehouseId: bigint | undefined; rackId: string }) {
  const { warehouseId, rackId } = args;

  // The unplaced pile has no rack id, and RackStock is a per-RACK read. Counting it is a real job and
  // it needs a different query — see the note on the page. Disabled rather than silently empty.
  const enabled = warehouseId !== undefined && rackId !== "" && rackId !== UNPLACED;

  return useQuery({
    ...listQuery,
    queryKey: key.racks(warehouseId, { opname: true, rackId }),
    enabled,
    queryFn: async (): Promise<ShelfContents> => {
      const stock = await rackClient.rackStock({
        teamId: warehouseId!,
        filter: { rackId: BigInt(rackId) },
        dataRequest: rackStockRowData(),
        page: SHELF_PAGE,
      });

      const lines = rackStockFromList(stock.items, stock.ids);
      const ids = lines.map((l) => l.productId);

      // An empty shelf is a legitimate answer, and asking ProductByIds for nothing is a round trip for
      // an empty map.
      let products: Product[] = [];
      if (ids.length > 0) {
        const res = await productClient.productByIds({
          // The team the CALLER holds a role in — this warehouse — never the team whose products come
          // back. A shelf holds other teams' goods, and a warehouse reads their labels with its own id,
          // exactly as it does for every other scoped call.
          teamId: warehouseId!,
          filter: { ids },
          dataRequest: productByIdsRowData(),
        });
        products = productsFromByIds(res);
      }

      const byId = new Map(products.map((p) => [p.id.toString(), p]));

      return {
        rows: lines.map((l) => {
          const p = byId.get(l.productId.toString());

          return {
            productId: l.productId,
            // A product whose catalogue row could not be resolved still gets a line. Leaving it out
            // would hide stock that is physically on the shelf, and the id is enough to count against.
            sku: p?.sku ?? "",
            name: p?.name ?? "",
            expected: l.onHand,
            unitCost: l.unitCost,
            costKnown: l.costKnown,
          };
        }),
        truncated: Number(stock.pageInfo?.totalItems ?? 0n) > lines.length,
      };
    },
  });
}

// Post the count. One call, one transaction, the whole shelf.
export function usePostOpname() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (args: { warehouseId: bigint; rackId: bigint; lines: StockOpnameLine[]; note: string }) => {
      const res = await inventoryClient.stockOpname({
        warehouseId: args.warehouseId,
        place: { place: { case: "rackId", value: args.rackId } },
        lines: args.lines,
        note: args.note,
      });

      return res;
    },
    onSuccess: () => {
      // A count moves stock, so everything that reads stock is now wrong on screen. Invalidated by
      // DOMAIN PREFIX rather than by exact key: the shelf, the product pages, the batch screens and
      // the placement tabs all read the numbers this just changed, and listing them here would be a
      // list that goes stale the next time somebody adds a stock screen.
      client.invalidateQueries({ queryKey: ["racks"] });
      client.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}
