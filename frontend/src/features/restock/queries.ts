import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryClient, restockClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import { fetchActors, useActors } from "../users/queries";
import type { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockDateField } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { restocksFromList, restockListRowData } from "./adapt";

// The restock screens' reads (#176).
//
// WHO DID WHAT — `fetchActors` / `useActors` now live in the USERS domain (features/users/queries.ts).
// They moved there when the order timeline needed the same lookup: resolving user ids to people is a
// question about USERS, not about restocks, and the alternative was a second copy that would drift.

export interface RestockListArgs {
  teamId: bigint | undefined;
  status: RestockRequestStatus;
  /** 0 = every warehouse. The SELLING side's lens — which building the goods are going to. */
  warehouseId?: bigint;
  /** 0 = every team. The WAREHOUSE side's mirror of it — which team the goods are coming from. */
  requestingTeamId?: bigint;
  /** 0 = anyone. Who RAISED the restock. */
  createdByUserId?: bigint;
  /**
   * 0 = anyone. Who COUNTED it at the door. Implies an accepted restock — a pending one records
   * nobody, so this and the Pending tab together correctly return nothing.
   */
  acceptedByUserId?: bigint;
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
    requestingTeamId = 0n,
    createdByUserId = 0n,
    acceptedByUserId = 0n,
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
      requestingTeamId: requestingTeamId.toString(),
      createdByUserId: createdByUserId.toString(),
      acceptedByUserId: acceptedByUserId.toString(),
      dateField,
      fromUnix: fromUnix.toString(),
      toUnix: toUnix.toString(),
      q,
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockRequestList({
        teamId: teamId!,
        filter: {
          status,
          warehouseId,
          requestingTeamId,
          createdByUserId,
          acceptedByUserId,
          dateField,
          fromUnix,
          toUnix,
          q,
        },
        dataRequest: restockListRowData(),
        page: { page, limit: pageSize },
      });

      const requests = restocksFromList(res.items, res.ids);

      // WHO RAISED IT AND WHO ACCEPTED IT, resolved in the same query rather than by each row —
      // one call for the whole page. Both columns come from the same map: the same person often
      // does both.
      const actors = await fetchActors(
        requests.flatMap((r) => [r.createdByUserId, r.acceptedByUserId]),
      );

      return {
        requests,
        actors,
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

// THE INBOUND HEADLINE (owner) — the warehouse side's mirror of useRestockOngoing above: what is
// still waiting at this warehouse's door, over every PENDING restock targeting it.
//
// A SEPARATE RPC rather than the same one read differently, and the reason is not tidiness. The
// buyer's tiles are about money it has committed and not received; these are about work that has not
// been done — different sets (`warehouse_id = team`, not `requesting_team_id = team`), and
// `OwnerStockStat`'s policy carries no warehouse roles at all, so the crew reading this screen would
// have got PermissionDenied from it.
//
// It takes the REQUESTING-TEAM FILTER and nothing else, exactly as the buyer's tiles take only the
// warehouse lens. That filter restates the question ("what is coming from Bandung"); a search box or
// a status tab picks rows out of an answer, and a headline that followed those would stop being one.
export function useRestockInbound(args: { teamId: bigint | undefined; requestingTeamId?: bigint }) {
  const { teamId, requestingTeamId = 0n } = args;

  return useQuery({
    queryKey: key.restock(teamId, {
      inbound: true,
      requestingTeamId: requestingTeamId.toString(),
    }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockInboundStat({
        teamId: teamId!,
        filter: { requestingTeamId },
      });

      return {
        restockCount: res.preview?.restockCount ?? 0n,
        productCount: res.preview?.productCount ?? 0n,
        unitCount: res.preview?.unitCount ?? 0n,
        amount: res.preview?.amount ?? 0n,
        oldestPendingUnix: res.preview?.oldestPendingUnix ?? 0n,
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

// The PEOPLE behind one restock's two actor ids — who raised it, who accepted it.
//
// A separate query rather than part of `useRestockRequest` on purpose: the request itself is the
// record, and who-did-it is read on top of it. Keeping them apart means the detail page renders the
// moment the restock arrives instead of waiting on user_service, and a `UserByIDs` that fails
// degrades one line of a timeline rather than blanking the page.
//
// Keyed on the ids, so the same two people are resolved once no matter which restock asks. No team
// in the key, and that is not the omission the queryClient warns about: `UserByIDs` takes no
// `team_id` — a public user by id reads the same for everyone — so there is no per-team answer to
// keep apart.
export function useRestockActors(userIds: bigint[]) {
  return useActors(userIds);
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
