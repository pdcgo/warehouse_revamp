import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, restockClient, userClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import { publicUsersByIds, userByIdsRowData } from "../users/adapt";
import type { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockDateField } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { restocksFromList, restockListRowData } from "./adapt";

// The restock screens' reads (#176).

export interface RestockListArgs {
  teamId: bigint | undefined;
  status: RestockRequestStatus;
  /** 0 = every warehouse. */
  warehouseId?: bigint;
  /** Which of a restock's three dates the range is about; UNSPECIFIED reads as created. */
  dateField?: RestockDateField;
  /** Unix seconds; 0 = open at that end. */
  fromUnix?: bigint;
  toUnix?: bigint;
  /** Free text over number / tracking / order ref / SKU / product name. */
  q?: string;
  page: number;
  pageSize: number;
}

export function useRestockRequests(args: RestockListArgs) {
  const {
    teamId,
    status,
    warehouseId = 0n,
    dateField = RestockDateField.UNSPECIFIED,
    fromUnix = 0n,
    toUnix = 0n,
    q = "",
    page,
    pageSize,
  } = args;

  return useQuery({
    // EVERY filter is in the key, because every one of them is SERVER-side — each combination is a
    // different question with its own `totalItems`, and sharing one entry across them would show one
    // filter's rows under another's pager.
    queryKey: key.restock(teamId, {
      status,
      warehouseId: warehouseId.toString(),
      dateField,
      fromUnix: fromUnix.toString(),
      toUnix: toUnix.toString(),
      q,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockRequestList({
        teamId: teamId!,
        filter: { status, warehouseId, dateField, fromUnix, toUnix, q },
        dataRequest: restockListRowData(),
        page: { page, limit: pageSize },
      });

      const requests = restocksFromList(res.items, res.ids);

      // WHO RAISED IT AND WHO ACCEPTED IT, resolved in the same query rather than by each row.
      //
      // The request carries user IDS, not names (a person's name is not part of what was agreed, so
      // it is read live rather than snapshotted) — so one UserByIDs call turns the whole page's
      // actors into names. Both columns come from the same map: the same person often does both.
      const actorNames = new Map<string, string>();
      const actorIds = [
        ...new Set(
          requests
            .flatMap((r) => [r.createdByUserId, r.acceptedByUserId])
            .filter((id) => id > 0n),
        ),
      ];

      if (actorIds.length > 0) {
        try {
          const users = publicUsersByIds(
            await userClient.userByIDs({
              filter: { ids: actorIds },
              dataRequest: userByIdsRowData(),
            }),
          );

          for (const [id, u] of Object.entries(users)) {
            actorNames.set(id, u.name || u.username);
          }
        } catch {
          // Left empty on purpose — a name lookup that fails must not take the list down with it.
          // Each column falls back to naming the id, exactly as an unresolved rack does.
        }
      }

      return {
        requests,
        actorNames,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// THE ONGOING STOCK HEADLINE (owner) — how much this team has bought that has not landed yet, and
// what it is worth.
//
// It is `OwnerStockStat`, not a total of the rows on screen, and that is the point: the tile
// describes what the team has in flight, while the table beside it shows twenty rows narrowed by a
// search box and a status tab. Adding up the visible rows would make the headline move every time
// somebody typed, which is the one thing a headline must not do.
//
// Server-side "ongoing" is exactly this screen's subject: Σ of the lines on PENDING restocks, scoped
// to the requesting team — so the tile and the Pending tab can never tell different stories.
//
// It takes the WAREHOUSE FILTER and nothing else. A warehouse lens restates the question ("what is
// in flight to Jakarta") rather than narrowing a list; a date range or a search box does not — those
// pick rows, and a headline that followed them would stop being a headline.
export function useRestockOngoing(args: { teamId: bigint | undefined; warehouseId?: bigint }) {
  const { teamId, warehouseId = 0n } = args;

  return useQuery({
    queryKey: key.restock(teamId, { ongoing: true, warehouseId: warehouseId.toString() }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await inventoryClient.ownerStockStat({ teamId: teamId!, filter: { warehouseId } });

      return {
        qty: res.preview?.ongoingQty ?? 0n,
        value: res.preview?.ongoingValueEst ?? 0n,
      };
    },
  });
}

// The printable labels for a fulfilled restock (#207), scoped to the accepting warehouse. Its own
// key params so it caches independently of the request detail — a different question about the same
// receipt. Only enabled once we have a warehouse team and a real request id.
export function useRestockLabels(args: { teamId: bigint | undefined; requestId: bigint }) {
  const { teamId, requestId } = args;

  return useQuery({
    queryKey: key.restock(teamId, { labels: requestId.toString() }),
    enabled: teamId !== undefined && requestId > 0n,
    queryFn: async () => {
      const res = await restockClient.restockRequestLabels({ teamId: teamId!, requestId });

      return res;
    },
  });
}

export function useRestockRequest(args: { teamId: bigint | undefined; requestId: bigint }) {
  const { teamId, requestId } = args;

  return useQuery({
    queryKey: key.restock(teamId, { requestId: requestId.toString() }),
    enabled: teamId !== undefined && requestId > 0n,
    queryFn: async () => {
      const res = await restockClient.restockRequestDetail({ teamId: teamId!, requestId });

      return res.request ?? null;
    },
  });
}

// A restock's lifecycle is the reason this is broad.
//
// Cancelling moves a row between tabs. Accepting moves it AND changes stock. Editing changes the
// detail and the row in every list that shows it. Each of those is a change to "the restock" as far
// as anyone reading a screen is concerned, so they all invalidate the same domain.
export function useInvalidateRestock() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["restock"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// Three writes, and they do NOT all invalidate the same thing — which is the point of declaring it
// here rather than leaving each screen to remember.
//
// ⚠ ACCEPTING IS THE ONE THAT CROSSES DOMAINS, and it is exactly the case #177 flags as the kind that
// gets missed. Fulfilling a restock is not a status change: it RECEIVES GOODS — stock levels move and
// the lines land on shelves. Invalidating `["restock"]` alone leaves the warehouse stock screen and
// the rack pages showing the counts from before the delivery arrived, on a screen whose whole job is
// to say what is on the shelf.
//
// So accept reuses `useInvalidateStock` from the inventory domain, which already fans out to
// inventory + restock + racks. Importing across domains is rare here and deliberate: the alternative
// is a second list of what a stock movement makes stale, and two such lists WILL drift.
//
// Creating, editing and cancelling a request move no goods, so they stay within `["restock"]`.

export function useSaveRestockRequest() {
  const invalidate = useInvalidateRestock();

  return useMutation({
    mutationFn: async (
      vars:
        | { requestId: bigint; fields: Parameters<typeof restockClient.restockRequestUpdate>[0] }
        | { requestId?: undefined; fields: Parameters<typeof restockClient.restockRequestCreate>[0] },
    ) =>
      vars.requestId === undefined
        ? await restockClient.restockRequestCreate(vars.fields)
        : await restockClient.restockRequestUpdate({ ...vars.fields, requestId: vars.requestId }),
    onSuccess: () => invalidate(),
  });
}

export function useCancelRestockRequest() {
  const invalidate = useInvalidateRestock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestCancel>[0]) =>
      restockClient.restockRequestCancel(vars),
    onSuccess: () => invalidate(),
  });
}

// Accepting a delivery. See the warning above for why this one invalidates stock and racks too.
export function useFulfillRestockRequest() {
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestFulfill>[0]) =>
      restockClient.restockRequestFulfill(vars),
    onSuccess: () => invalidateStock(),
  });
}
