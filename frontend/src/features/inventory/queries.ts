import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, orderClient, productClient, restockClient, teamClient } from "../../api/clients";
import { key } from "../../api/queryClient";

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

// Where a set of products already live in this warehouse (#156) — so a put-away adds to the existing
// pile rather than starting a second one in another aisle.
export function useProductPlaces(args: { warehouseId: bigint | undefined; productIds: bigint[] }) {
  const { warehouseId, productIds } = args;

  return useQuery({
    // The ids are part of the question, so they are part of the key — sorted, because the same set
    // arriving in a different order is the same question and must not be a second cache entry.
    queryKey: key.inventory(warehouseId, {
      places: productIds.map((id) => id.toString()).sort(),
    }),
    enabled: warehouseId !== undefined && productIds.length > 0,
    queryFn: async () => {
      const found = await inventoryClient.productPlaces({
        warehouseId: warehouseId!,
        productIds,
      });

      return found.places;
    },
  });
}

// The batches (cost layers) of one product at a warehouse (#209/#210) — for the Move/Adjust dialogs'
// batch pickers. Only batches that still hold something; a large first page since a picker needs the
// whole (small) set, not a window.
export function useProductBatches(args: { warehouseId: bigint | undefined; productId: bigint }) {
  const { warehouseId, productId } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { batches: productId.toString() }),
    enabled: warehouseId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await inventoryClient.batchList({
        teamId: warehouseId!,
        productId,
        page: { page: 1, limit: 200 },
      });

      // A depleted batch cannot be moved or adjusted, so it is not offered.
      return res.batches.filter((b) => b.ready > 0n);
    },
  });
}

// The cost layers of one product (#209) — the Prices tab: on-hand grouped by frozen cost. A first
// page large enough for the handful of layers a product accrues.
export function useCostLayers(args: { warehouseId: bigint | undefined; productId: bigint }) {
  const { warehouseId, productId } = args;

  return useQuery({
    queryKey: key.inventory(warehouseId, { costLayers: productId.toString() }),
    enabled: warehouseId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await inventoryClient.costLayerList({
        teamId: warehouseId!,
        productId,
        page: { page: 1, limit: 100 },
      });
      return res;
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

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The three ways stock changes by hand. All of them go through `useInvalidateStock` above, which is
// the cross-domain fan-out #177 warns is the thing that gets missed — and it is why these hooks are
// worth having at all rather than each dialog invalidating for itself. A dialog that reached for
// `["inventory"]` alone would leave the rack page showing what was on the shelf before the move.
//
// Note what is NOT here: picking, and accepting a restock. Those move stock too, but they are the
// warehouse's own flows with their own screens (src/picking, src/restock), and they invalidate from
// there — through this same hook, so the fan-out stays in one place.

// The vars are taken FROM THE CLIENT METHOD rather than restated here. The `place` field is a
// generated oneof whose shape differs per request message, and a hand-written copy of it is a second
// definition that silently stops matching the day the proto changes.
export function useReceiveStock() {
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof inventoryClient.stockReceive>[0]) =>
      inventoryClient.stockReceive(vars),
    onSuccess: () => invalidate(),
  });
}

export function useAdjustStock() {
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof inventoryClient.stockAdjust>[0]) =>
      inventoryClient.stockAdjust(vars),
    onSuccess: () => invalidate(),
  });
}

export function useMoveStock() {
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof inventoryClient.stockMove>[0]) =>
      inventoryClient.stockMove(vars),
    onSuccess: () => invalidate(),
  });
}
