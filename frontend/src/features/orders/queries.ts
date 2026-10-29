import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderClient, productClient, teamReturnConfigurationClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import type { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderDateField } from "../../gen/warehouse/selling/v1/order_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useInvalidateStock } from "../inventory/queries";
import { productByIdsRowData, productsFromByIds } from "../products/adapt";
import { useProductsByIds } from "../products/queries";
import { peopleFor, WHO_FILTER_SIZE } from "../users/queries";
import { orderListRowData, ordersFromList } from "./adapt";

// The order screens' reads (#176).

// The filters the LIST and the STAT share — search, shop, the date window, and who typed it in.
//
// One type used by both hooks, deliberately. The header sits directly above the table, so the two
// calls must be given the same narrowing or the counts describe a bigger population than the rows;
// making it one object is what stops a caller passing the search to one and forgetting the other.
// `status` is not here: it is the tab, and it belongs to the list alone.
export interface OrderFilters {
  /** Free text over the customer's name, their phone, and the order id. "" = no filter. */
  search: string;
  /** Only orders placed on this shop. 0n = no filter. */
  shopId: bigint;
  /** The `created_at` window, unix seconds, inclusive. 0n on a side is an OPEN end. */
  fromUnix: bigint;
  toUnix: bigint;
  /** Only orders this person typed in. 0n or absent = anybody. */
  createdByUserId?: bigint;
  /** Only this selling team's orders — the warehouse's filter (the-filter-gains-seller-marketplace-and-courier). 0n or absent = any. */
  sellerTeamId?: bigint;
  /** Only orders whose shop is on this marketplace. UNSPECIFIED or absent = any. */
  marketplace?: Marketplace;
  /** Only orders with this courier (`shipping_code`). "" or absent = any. */
  shippingCode?: string;
  /** Only orders shipping from this warehouse — the seller list's filter. 0n or absent = any. */
  warehouseId?: bigint;
  /**
   * Which date `fromUnix`/`toUnix` read — when we wrote the row (the default) or when the buyer ordered on the
   * storefront (the-date-filter-switches-created-or-platform). Absent = created.
   */
  dateField?: OrderDateField;
}

export const NO_ORDER_FILTERS: OrderFilters = {
  search: "",
  shopId: 0n,
  fromUnix: 0n,
  toUnix: 0n,
};

// bigints are not JSON-serialisable and TanStack hashes keys with JSON.stringify, so the filters go
// into the key as strings — the same rule the team id already follows in api/queryClient.ts.
const filterKey = (f: OrderFilters) => ({
  search: f.search,
  shopId: f.shopId.toString(),
  fromUnix: f.fromUnix.toString(),
  toUnix: f.toUnix.toString(),
  createdByUserId: (f.createdByUserId ?? 0n).toString(),
  sellerTeamId: (f.sellerTeamId ?? 0n).toString(),
  marketplace: f.marketplace ?? Marketplace.UNSPECIFIED,
  shippingCode: f.shippingCode ?? "",
  warehouseId: (f.warehouseId ?? 0n).toString(),
  dateField: f.dateField ?? OrderDateField.UNSPECIFIED,
});

const filterMsg = (f: OrderFilters) => orderListFilterMsg(f);

/** The OrderListFilter fields for these filters — what the list, the stat and the export all send. */
export const orderListFilterMsg = (f: OrderFilters) => ({
  search: f.search,
  shopId: f.shopId,
  createdFromUnix: f.fromUnix,
  createdToUnix: f.toUnix,
  createdByUserId: f.createdByUserId ?? 0n,
  sellerTeamId: f.sellerTeamId ?? 0n,
  marketplace: f.marketplace ?? Marketplace.UNSPECIFIED,
  shippingCode: f.shippingCode ?? "",
  warehouseId: f.warehouseId ?? 0n,
  dateField: f.dateField ?? OrderDateField.UNSPECIFIED,
});

export function useOrders(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
  status: OrderStatus;
  filters?: OrderFilters;
}) {
  const { teamId, page, pageSize, status, filters = NO_ORDER_FILTERS } = args;

  return useQuery({
    // `listQuery`: the status tab, the filter bar and the pager all REFINE the same question — "this
    // team's orders" — so the rows already on screen stay put while the next answer loads, instead of
    // the table tearing down. That matters most for the SEARCH BOX: it re-queries as somebody types,
    // and a table that blanked between keystrokes would be unusable however fast the server answered.
    // The page pairs it with a RefreshOverlay, which is the other half.
    ...listQuery,
    queryKey: key.orders(teamId, { page, pageSize, status, ...filterKey(filters) }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderList({
        teamId: teamId!,
        filter: { status, ...filterMsg(filters) },
        dataRequest: orderListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        orders: ordersFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The header above the list: the census by status, and the last thirty days of money.
//
// Deliberately NOT keyed on the tab or the page. The counts are what you read to decide which tab to
// open, so recomputing them per tab would empty the very number you were about to click — and turning
// a page cannot change them. The key carries only what the stat is actually filtered by.
//
// It IS keyed on the search, the shop and the date window, and that is the other half of the same
// rule: those three change which orders exist for the screen, so a header that ignored them would
// count a population the table below it does not show — "Placed 12" over four rows, with nothing
// explaining the gap. The server shares one query builder between the two RPCs for the same reason.
export function useOrderStat(args: {
  teamId: bigint | undefined;
  productId?: bigint;
  filters?: OrderFilters;
}) {
  const { teamId, productId = 0n, filters = NO_ORDER_FILTERS } = args;

  return useQuery({
    queryKey: key.orders(teamId, {
      stat: 1,
      productId: productId.toString(),
      ...filterKey(filters),
    }),
    enabled: teamId !== undefined,
    queryFn: () =>
      orderClient.orderStat({ teamId: teamId!, filter: { productId, ...filterMsg(filters) } }),
  });
}

// WHO THE LIST'S "CREATED BY" FILTER OFFERS (a-who-filter-lists-the-people-on-its-rows): everyone who typed in an
// order this team may list, the latest first, named with one UserByIDs — never the team's member list, which
// would miss whoever has left and offer whoever never typed one. Customer Service asks too
// (whoever-reads-a-list-may-filter-it).
//
// `referenceQuery`: it LABELS a picker, and is re-read whenever one mounts.
export function useOrderCreators(args: { teamId: bigint | undefined }) {
  const { teamId } = args;

  return useQuery({
    queryKey: key.orders(teamId, { creators: 1 }),
    ...referenceQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderCreatorList({
        teamId: teamId!,
        page: { page: 1, limit: WHO_FILTER_SIZE },
      });

      return peopleFor(res.ids);
    },
  });
}

export function useOrder(args: { teamId: bigint | undefined; orderId: bigint }) {
  const { teamId, orderId } = args;

  return useQuery({
    queryKey: key.orders(teamId, { orderId: orderId.toString() }),
    enabled: teamId !== undefined && orderId > 0n,
    queryFn: async () => {
      const res = await orderClient.orderDetail({ teamId: teamId!, orderId });

      return res.order ?? null;
    },
  });
}

// Confirm and cancel happen on the DETAIL page and change a status the LIST also shows. Invalidating
// the whole domain is what keeps the two honest: without it, confirming an order and pressing back
// shows the status it had before — the screen is not wrong about anything it fetched, it simply
// fetched before the change.
//
// The same applies to creating an order, which lands on the detail page and leaves a list behind it.
export function useInvalidateOrders() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["orders"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The selling side's three writes. All of them stay inside `["orders"]`, and that is a statement
// about the design rather than an omission:
//
//   - `OrderCreate` does NOT touch inventory (§3.3 — stock integration is #69, still blocked), so
//     placing an order cannot stale a stock figure. The day #69 lands, THIS is the hook that has to
//     start invalidating stock, and it is the reason the write lives here rather than in the page.
//   - `OrderCancel` reverses no stock or money either — that is #70, and it waits on #69.
//
// Every other status move — the warehouse's and customer service's alike — is `useOrderStatusChange` below.

export function useCreateOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderCreate>[0]) => orderClient.orderCreate(vars),
    onSuccess: () => invalidate(),
  });
}

// There is no useConfirmOrder, and no per-step fulfilment hook: confirming is one of the plain moves, and
// every plain move is `useOrderStatusChange` (one-status-change-for-every-plain-move). A second hook for one
// step would be a second way to make the same call — and the one somebody reached for by name would be the
// one that forgot to invalidate stock.

export function useCancelOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderCancel>[0]) => orderClient.orderCancel(vars),
    onSuccess: () => invalidate(),
  });
}

// EDIT RESI (the-seller-edits-the-resi-until-handover) — the tracking number, the label file, or both, while the parcel
// is still in the building. It moves no status and no stock, so only the order domain goes stale.
export function useUpdateOrderReceipt() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderClient.orderReceiptUpdate>[0]) => orderClient.orderReceiptUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

// ONE MOVE FOR MANY ORDERS (one-status-change-for-every-plain-move) — the warehouse's confirm, pick, hand
// back and handover, and customer service's shipped, completed, problem, lost and forced return. Cancel
// keeps `useCancelOrder`: it does more than move a status.
//
// ⚠ IT RESOLVES EVEN WHEN SOME ORDERS WERE REFUSED. Each order has its own result — a handover scan of
// 30 where 2 were never picked moves the 28 — so the caller reads `results` and says what did not move.
// Only a failed CALL (no team, the network) rejects.
//
// ⚠ IT INVALIDATES STOCK TOO. No move here takes stock off a shelf today (the take happens at create),
// but the stock screens read an order's status for their "reserved / waiting" numbers, and a rule like
// "only these moves stale stock" is one the next person editing this has to remember. Broad is cheap.
export function useOrderStatusChange() {
  const invalidateOrders = useInvalidateOrders();
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: async (vars: Parameters<typeof orderClient.orderStatusChange>[0]) =>
      (await orderClient.orderStatusChange(vars)).results,
    onSuccess: () => Promise.all([invalidateOrders(), invalidateStock()]),
  });
}

// ADD A NOTE TO AN ORDER (a-note-is-a-timeline-row) — a timeline row with no status, written by either end: the
// selling team's `team_id` writes `from = selling`, its warehouse's writes `from = warehouse`. There is no edit and
// no delete, so this is the only note write there is: a correction is a new note.
//
// It resolves to the written row. It INVALIDATES the order domain rather than splicing the row into the cached
// detail: the note list is a read of `OrderDetail`'s `timeline_logs`, and the pick screen reads the same rows under
// its own key — re-reading both is what keeps them showing the same notes.
export function useCreateOrderNote() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: async (vars: Parameters<typeof orderClient.orderNoteCreate>[0]) =>
      (await orderClient.orderNoteCreate(vars)).log,
    onSuccess: () => invalidate(),
  });
}

// ── The return warehouse (the-return-warehouse-lives-in-team-return-configurations) ─────────────────
//
// Where a selling team's returned parcels are received — one row per team, in the order context, because
// order create is what will refuse a team without one (create-refuses-a-team-with-no-return-warehouse).

/** The team's return configuration, or `null` when it has not set one — a normal state, not an error. */
export function useTeamReturnConfiguration(args: { teamId: bigint | undefined }) {
  const { teamId } = args;

  return useQuery({
    queryKey: key.returnConfiguration(teamId),
    enabled: teamId !== undefined && teamId > 0n,
    queryFn: async () => {
      const res = await teamReturnConfigurationClient.teamReturnConfigurationDetail({ teamId: teamId! });

      return res.configuration ?? null;
    },
  });
}

/** Set — or replace — the team's return warehouse. There is no clear: a team without one is what create refuses. */
export function useSetTeamReturnConfiguration() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { teamId: bigint; warehouseId: bigint }) =>
      (await teamReturnConfigurationClient.teamReturnConfigurationSet(vars)).configuration,
    onSuccess: () => client.invalidateQueries({ queryKey: ["returnConfiguration"] }),
  });
}

/**
 * Which of these teams HAVE set a return warehouse — root's Teams list marks the selling teams that have not
 * (root-sees-which-teams-have-no-return-warehouse). Root and the Administrator only: the read is unscoped, so
 * pass `enabled: false` for anybody else rather than collecting a refusal.
 */
export function useTeamsWithReturnWarehouse(args: { teamIds: bigint[]; enabled: boolean }) {
  const { teamIds, enabled } = args;

  return useQuery({
    queryKey: key.returnConfiguration(undefined, { teamIds: teamIds.map(String).join(",") }),
    enabled: enabled && teamIds.length > 0,
    queryFn: async () => {
      const res = await teamReturnConfigurationClient.teamReturnConfigurationByIds({ filter: { ids: teamIds } });

      return new Set(Object.keys(res.items).map((id) => BigInt(id)));
    },
  });
}

// ── The return map (the-return-map-is-selling-services-and-read-by-ids) ─────────────────────────────────────────
//
// Which of the team's OWN products a borrowed product comes back as. Written once, at the confirmed pick on the order
// form (the-map-is-written-when-it-is-picked); read by the borrowed products' ids so a row already mapped arrives locked.

/** A standing pair: our product, NAMED from the product read — `name` is undefined while that read is in flight. */
export interface StandingReturnMap {
  productId: bigint;
  name?: string;
}

/**
 * The team's standing maps for these BORROWED products, keyed by the borrowed id as a string. A product the team has
 * not mapped is absent — the row the form asks about. `data` is undefined until the pairs are read. A pair's `name`
 * comes from `ProductByIds`, the read that names a product everywhere else — the map stores no name.
 */
export function useProductReturnMaps(args: { teamId: bigint | undefined; sharedProductIds: bigint[] }) {
  const { teamId } = args;
  const ids = [...new Set(args.sharedProductIds.filter((id) => id > 0n))].sort();
  const enabled = teamId !== undefined && teamId > 0n && ids.length > 0;

  const pairs = useQuery({
    queryKey: key.returnMaps(teamId, { ids: ids.map(String).join(",") }),
    enabled,
    queryFn: async () => {
      const res = await teamReturnConfigurationClient.productReturnMapByIds({ teamId: teamId!, filter: { ids } });
      const out = new Map<string, bigint>();

      for (const [id, list] of Object.entries(res.items)) {
        for (const item of list.items) {
          if (item.d.case !== "pair") continue;
          const pair = item.d.value.mapData[id];
          if (pair) out.set(id, pair.ownProductId);
        }
      }

      return out;
    },
  });

  const ownIds = useMemo(() => [...(pairs.data?.values() ?? [])], [pairs.data]);
  const names = useProductsByIds({ teamId, productIds: ownIds });

  const data = useMemo(() => {
    if (!pairs.data) return undefined;

    const out = new Map<string, StandingReturnMap>();
    for (const [shared, own] of pairs.data) {
      out.set(shared, { productId: own, name: names.data?.get(own.toString())?.name });
    }

    return out;
  }, [pairs.data, names.data]);

  // A disabled query stays "pending" in TanStack v5 — only a read actually asked for is still being answered.
  return { data, isPending: enabled && pairs.isPending, isError: pairs.isError };
}

/** What the write left standing: our product, its name, and whether THIS call wrote it. */
export interface WrittenReturnMap {
  productId: bigint;
  name: string;
  created: boolean;
}

/**
 * Map a borrowed product to one of ours — its own call, never part of OrderCreate. A pair that already stands is not
 * overwritten: it comes back with `created = false`, and when it names a different product from the one picked, that
 * product is named here from `ProductByIds`, so the card shows what stands rather than what was asked for.
 */
export function useCreateProductReturnMap() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      teamId: bigint;
      sharedProductId: bigint;
      ownProductId: bigint;
      /** The picked product's name — the answer's name too, unless a different pair already stands. */
      ownName: string;
    }): Promise<WrittenReturnMap> => {
      const res = await teamReturnConfigurationClient.productReturnMapCreate({
        teamId: vars.teamId,
        sharedProductId: vars.sharedProductId,
        ownProductId: vars.ownProductId,
      });
      const standing = res.map?.ownProductId ?? vars.ownProductId;

      if (standing === vars.ownProductId) {
        return { productId: standing, name: vars.ownName, created: res.created };
      }

      const named = await productClient.productByIds({
        teamId: vars.teamId,
        filter: { ids: [standing] },
        dataRequest: productByIdsRowData(),
      });

      return {
        productId: standing,
        name: productsFromByIds(named)[0]?.name ?? `#${standing.toString()}`,
        created: res.created,
      };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["returnMaps"] }),
  });
}
