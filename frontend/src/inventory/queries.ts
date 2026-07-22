import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, orderClient, productClient, restockClient, teamClient } from "../api/clients";
import { key } from "../api/queryClient";

// The inventory screens' reads (#176).

// One page of a warehouse's catalogue, with the on-hand level for each row.
//
// Both calls in one query function, as the old effect had them: a product row without its count is
// not a stock screen, and rendering the names first would show a column of blanks that reads as
// "zero" rather than "still loading".
//
// The levels call asks for ONE large page rather than matching the product pager — it is a lookup
// table for the rows on screen, not a list in its own right.
export function useWarehouseStock(args: {
  warehouseId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
  levelLimit: number;
}) {
  const { warehouseId, q, page, pageSize, levelLimit } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { q, page, pageSize }),
    enabled: warehouseId !== undefined,
    queryFn: async () => {
      const [productRes, stockRes] = await Promise.all([
        productClient.productList({
          teamId: warehouseId!,
          q,
          page: { page, limit: pageSize },
        }),
        inventoryClient.stockList({ warehouseId: warehouseId!, page: { page: 1, limit: levelLimit } }),
      ]);

      const onHand = new Map<string, bigint>();
      for (const level of stockRes.levels) {
        onHand.set(level.productId.toString(), level.onHand);
      }

      return {
        products: productRes.products,
        onHand,
        totalItems: Number(productRes.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// ── The warehouse's view of ONE product (#158) ──────────────────────────────────────────────────
//
// TWO queries, not one, and this is the conversion fixing something rather than porting it.
//
// The old loader carried this note above its second block: "Fetched after the block above rather
// than inside it: they are the lower half of the page, and a failure here should not cost the stock
// figures at the top." The intent is right and the code did not achieve it — both blocks shared one
// try/catch, so an order-history failure set the page error and blanked the figures it meant to
// protect. Two queries is what that comment actually asks for: the stock half renders whether or not
// the activity half succeeds.

// The top of the page: what this product IS, where it sits, what it cost, and its stock ledger.
export function useWarehouseProduct(args: {
  warehouseId: bigint | undefined;
  productId: bigint;
  adjustKind: number;
  moveKind: number;
}) {
  const { warehouseId, productId, adjustKind, moveKind } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { productId: productId.toString() }),
    enabled: warehouseId !== undefined && productId > 0n,
    queryFn: async () => {
      // A warehouse may read a product it does not own BY ID (#138's rule): a person standing at a
      // shelf must be able to read the label on the box sitting on it.
      const found = await productClient.productByIds({
        teamId: warehouseId!,
        productIds: [productId],
      });
      const product = found.products[0] ?? null;

      const [placesRes, costRes, opnameRes, historyRes, moveRes] = await Promise.all([
        inventoryClient.productPlaces({ warehouseId: warehouseId!, productIds: [productId] }),
        inventoryClient.stockCost({
          teamId: warehouseId!,
          warehouseId: warehouseId!,
          productIds: [productId],
        }),
        // The LAST stock-take. Filtered server-side (#158) — page one of an unfiltered ledger would
        // report "never counted" the moment the last one scrolled off it.
        inventoryClient.stockHistory({
          warehouseId: warehouseId!,
          productId,
          page: { page: 1, limit: 1 },
          kind: adjustKind,
        }),
        inventoryClient.stockHistory({
          warehouseId: warehouseId!,
          productId,
          page: { page: 1, limit: 50 },
        }),
        inventoryClient.stockHistory({
          warehouseId: warehouseId!,
          productId,
          page: { page: 1, limit: 50 },
          kind: moveKind,
        }),
      ]);

      // Who owns the catalogue entry — a warehouse holds other teams' products (#142). Best-effort:
      // an unknown or soft-deleted id is OMITTED from the map, so this is a presence check rather
      // than a blind index, and a deleted owning team leaves the badge off rather than showing blank.
      let ownerName = "";
      if (product && product.teamId > 0n) {
        try {
          const teams = await teamClient.teamByIds({ ids: [product.teamId] });
          ownerName = teams.data[product.teamId.toString()]?.name ?? "";
        } catch {
          ownerName = "";
        }
      }

      // ABSENT means the cost is UNKNOWN, not zero (#74). A valuation computed over an unknown cost
      // would read as "these goods are worth nothing", which is a different claim entirely.
      const cost = costRes.costs[0];

      return {
        product,
        ownerName,
        places: placesRes.places,
        unitCost: cost?.unitCost ?? 0n,
        costKnown: cost !== undefined,
        lastOpname: opnameRes.movements[0] ?? null,
        history: historyRes.movements,
        placementHistory: moveRes.movements,
      };
    },
  });
}

// The lower half: what has been sold, delivered, and is still on its way. Its own query, so its
// failure costs only itself.
export function useWarehouseProductActivity(args: {
  warehouseId: bigint | undefined;
  productId: bigint;
  fulfilledStatus: number;
  pendingStatus: number;
}) {
  const { warehouseId, productId, fulfilledStatus, pendingStatus } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { productId: productId.toString(), activity: true }),
    enabled: warehouseId !== undefined && productId > 0n,
    queryFn: async () => {
      const [orderRes, restockRes, incomingRes] = await Promise.all([
        orderClient.orderList({ teamId: warehouseId!, productId, page: { page: 1, limit: 5 } }),
        // Fulfilled deliveries — the BATCHES (owner, 2026-07-21: a batch is a delivery).
        restockClient.restockRequestList({
          teamId: warehouseId!,
          productId,
          status: fulfilledStatus,
          page: { page: 1, limit: 20 },
        }),
        // Still on its way — D's "ongoing restock".
        restockClient.restockRequestList({
          teamId: warehouseId!,
          productId,
          status: pendingStatus,
          page: { page: 1, limit: 20 },
        }),
      ]);

      return {
        lastOrders: orderRes.orders,
        restocks: restockRes.requests,
        incoming: incomingRes.requests,
      };
    },
  });
}

// Receive, adjust and move all change what is on a shelf, so they all land here.
//
// This also invalidates RESTOCK and RACKS, because stock is the thing those screens are about: a
// receive completes a restock, and a move changes what a rack holds. Cross-domain invalidation is
// rare in this codebase and deliberate here — the alternative is a rack page that shows what was on
// the shelf before somebody moved it.
export function useInvalidateStock() {
  const client = useQueryClient();

  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["restock"] }),
      client.invalidateQueries({ queryKey: ["racks"] }),
    ]);
  };
}
