import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { restockClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import { fetchActors, peopleFor, useActors, WHO_FILTER_SIZE } from "../users/queries";
import type { RestockActorRole } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockDateField, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useDebounced } from "../../lib/useDebounced";
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

      // WHO RAISED IT, WHO SIGNED FOR THE BOX AND WHO ACCEPTED IT, resolved in the same query rather than by each row —
      // one call for the whole page. Every column comes from the same map: the same person often does two.
      const actors = await fetchActors(
        requests.flatMap((r) => [r.createdByUserId, r.arrivedByUserId, r.acceptedByUserId]),
      );

      return {
        requests,
        actors,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

/** Which of a restock's references a check is about — the resi, or the store's Order ID. */
export type RestockRef = "receipt" | "invoiceRef";

/**
 * What the form knows about a reference it was given:
 *
 *   idle      nothing typed, or the field is closed
 *   checking  typed, and the answer is not in yet — the debounce, then the read
 *   free      no other restock holds it
 *   taken     the newest restock holding it, which is not cancelled
 *   failed    the read failed — said under the field, and nothing is held back on it
 */
export type RefCheck =
  | { state: "idle" | "checking" | "free" | "failed" }
  | { state: "taken"; id: bigint; status: RestockRequestStatus };

// How many search hits are read. The search is a substring match over the resi, the Order ID and the lines' SKU and
// name, and the exact match is picked out of it here — a full reference matches a handful, never a page.
const IN_USE_PAGE = 50;

const normalised = (ref: string) => ref.trim().toLowerCase();

// IS THIS RESI — OR THIS ORDER ID — ALREADY ON ANOTHER RESTOCK? (owner: *"ada checker … untuk cek resi dan order id ->
// danger langsung di formnya"*, *"hasil checkernya jadi validasi juga"*, a-reference-in-use-stops-the-restock-form).
//
// Asked of the LIST's own search (`filter.q` reaches the resi and the Order ID), then matched EXACTLY, letter case
// aside: `jne0123` and `JNE0123` are one parcel. A CANCELLED restock holds nothing — its parcel never came — and the
// restock being edited is not its own duplicate. Every other status holds it: an accepted box cannot arrive twice, and
// a lost one may still turn up.
//
// ⚠ THIS TEAM'S RESTOCKS ONLY — the list a selling team may read. A resi on another team's restock is not caught, and
// nothing on the server refuses a repeated one: the form's two pending marks say so (`restock-form/pending.ts`).
//
// Keyed on the value, so each one typed is its own question — never `listQuery`, which would show the answer about the
// previous value while asking about this one.
export function useRestockRefInUse(args: {
  teamId: bigint | undefined;
  ref: RestockRef;
  value: string;
  /** The restock being edited; 0n on create. */
  exceptId: bigint;
  /** False while the field is closed — an arrived restock's references are not asked about again. */
  enabled: boolean;
}): RefCheck {
  const { teamId, ref, value, exceptId, enabled } = args;
  const typed = normalised(value);
  // Asked once the typing pauses, not per keystroke.
  const asked = useDebounced(typed, 400);
  const on = enabled && teamId !== undefined && asked !== "";

  const query = useQuery({
    queryKey: key.restock(teamId, { inUse: ref, value: asked, except: exceptId.toString() }),
    enabled: on,
    queryFn: async () => {
      const res = await restockClient.restockRequestList({
        teamId: teamId!,
        filter: { q: asked },
        dataRequest: restockListRowData(),
        page: { page: 1, limit: IN_USE_PAGE },
      });

      const holder = restocksFromList(res.items, res.ids).find(
        (r) =>
          r.id !== exceptId &&
          r.status !== RestockRequestStatus.CANCELLED &&
          normalised(ref === "receipt" ? r.receipt : r.invoiceRefId) === asked,
      );

      return holder ? { id: holder.id, status: holder.status } : null;
    },
  });

  if (!enabled || teamId === undefined || typed === "") return { state: "idle" };
  if (asked !== typed || query.isPending) return { state: "checking" };
  if (query.isError) return { state: "failed" };

  return query.data ? { state: "taken", ...query.data } : { state: "free" };
}

// WHO A RESTOCK LIST'S "WHO" FILTER OFFERS (a-who-filter-lists-the-people-on-its-rows): everyone who raised — or
// accepted — a restock this team may list, the latest first, named with one UserByIDs. Never a team's member list:
// the people who counted a selling team's deliveries work at the warehouse, whose members it cannot read. Anyone who
// may read the list may ask (whoever-reads-a-list-may-filter-it), Staff and Customer Service included.
//
// `referenceQuery`: it LABELS a picker, and is re-read whenever one mounts.
export function useRestockPeople(args: { teamId: bigint | undefined; role: RestockActorRole }) {
  const { teamId, role } = args;

  return useQuery({
    queryKey: key.restock(teamId, { people: role }),
    ...referenceQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockActorList({
        teamId: teamId!,
        filter: { role },
        page: { page: 1, limit: WHO_FILTER_SIZE },
      });

      return peopleFor(res.ids);
    },
  });
}

// THE INBOUND HEADLINE (owner) — the warehouse side's in-flight figures (the selling list's were OwnerStockStat): what is
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
        amount: res.preview?.amount ?? 0,
        oldestPendingUnix: res.preview?.oldestPendingUnix ?? 0n,
      };
    },
  });
}

// The printable labels for a fulfilled restock (#207), scoped to the accepting warehouse. Its own
// key params so it caches independently of the request detail — a different question about the same
// receipt. Only enabled once we have a warehouse team and a real request id.
//
// The OPTIONS are exported as well as the hook, so a page reading several restocks at once (Cetak Label over many,
// labels-print-several-restocks) asks `useQueries` the very same question — one cache entry per restock, shared with
// the single reads.
export function restockLabelsQuery(teamId: bigint | undefined, requestId: bigint) {
  return {
    queryKey: key.restock(teamId, { labels: requestId.toString() }),
    enabled: teamId !== undefined && requestId > 0n,
    queryFn: async () => {
      const res = await restockClient.restockRequestLabels({ teamId: teamId!, requestId });

      return res;
    },
  };
}

export function useRestockLabels(args: { teamId: bigint | undefined; requestId: bigint }) {
  return useQuery(restockLabelsQuery(args.teamId, args.requestId));
}

export function restockRequestQuery(teamId: bigint | undefined, requestId: bigint) {
  return {
    queryKey: key.restock(teamId, { requestId: requestId.toString() }),
    enabled: teamId !== undefined && requestId > 0n,
    queryFn: async () => {
      const res = await restockClient.restockRequestDetail({ teamId: teamId!, requestId });

      return res.request ?? null;
    },
  };
}

export function useRestockRequest(args: { teamId: bigint | undefined; requestId: bigint }) {
  return useQuery(restockRequestQuery(args.teamId, args.requestId));
}

// How many of each printable status the picker offers before anything is typed.
const LABELABLE_PAGE = 10;

// THE RESTOCKS THAT HAVE LABELS — Tiba and Diterima, for Cetak Label's *Tambah Restok* (labels-print-several-restocks):
// the newest of each, narrowed by the list's own search (number, resi, Order ID, a line's SKU or name). The list takes
// ONE status, so it is asked twice and the two answers merged, newest first — a picker that offered every status
// would open on boxes still on the road, none of which can be picked.
//
// `referenceQuery`: a picker feed (HARD RULE 10). What is picked is read again, whole, by the page.
export function useLabelableRestocks(args: { teamId: bigint | undefined; q: string }) {
  const { teamId, q } = args;

  return useQuery({
    queryKey: key.restock(teamId, { labelable: q }),
    ...referenceQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const ask = (status: RestockRequestStatus) =>
        restockClient.restockRequestList({
          teamId: teamId!,
          filter: { status, q },
          dataRequest: restockListRowData(),
          page: { page: 1, limit: LABELABLE_PAGE },
        });
      const [arrived, accepted] = await Promise.all([
        ask(RestockRequestStatus.ARRIVED),
        ask(RestockRequestStatus.ACCEPTED),
      ]);

      return [...restocksFromList(arrived.items, arrived.ids), ...restocksFromList(accepted.items, accepted.ids)].sort(
        (a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0),
      );
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

// Counting the box in (accept-locks-the-restock). See the warning above for why this one invalidates stock and racks
// too.
export function useAcceptRestockRequest() {
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestAccept>[0]) =>
      restockClient.restockRequestAccept(vars),
    onSuccess: () => invalidateStock(),
  });
}

// The warehouse signing for the box: ongoing or lost → arrived (the-warehouse-signs-and-accepts-the-team-does-the-rest).
// No goods move — the box is in the building, not yet counted — so it stays within ["restock"].
export function useArriveRestockRequest() {
  const invalidate = useInvalidateRestock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestArrive>[0]) =>
      restockClient.restockRequestArrive(vars),
    onSuccess: () => invalidate(),
  });
}

// KOREKSI JUMLAH TERIMA — the receiving warehouse corrects an accepted restock's received count
// (the-warehouse-corrects-a-wrong-stock-in-alone): units leave or enter the line's batch and a rack, so it fans out as the
// accept does (stock, racks, the batch's history). A refused one re-reads too — a stale form's line was changed by
// someone else, and the page behind the form should show what it is now.
export function useCorrectRestockReceivedCount() {
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockReceivedCountCorrect>[0]) =>
      restockClient.restockReceivedCountCorrect(vars),
    onSettled: () => invalidateStock(),
  });
}

// The selling team giving the parcel up: ongoing → lost (lost-is-set-only-before-the-box-arrives).
export function useMarkLostRestockRequest() {
  const invalidate = useInvalidateRestock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestMarkLost>[0]) =>
      restockClient.restockRequestMarkLost(vars),
    onSuccess: () => invalidate(),
  });
}
