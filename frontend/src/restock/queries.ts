import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { restockClient } from "../api/clients";
import { key } from "../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import type { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";

// The restock screens' reads (#176).

export function useRestockRequests(args: {
  teamId: bigint | undefined;
  status: RestockRequestStatus;
  page: number;
  pageSize: number;
}) {
  const { teamId, status, page, pageSize } = args;

  return useQuery({
    // `status` is in the key because it is a SERVER-side filter — each tab is a different question,
    // with its own `totalItems`. Sharing one entry across tabs would show one tab's rows under
    // another's pager.
    queryKey: key.restock(teamId, { status, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockRequestList({
        teamId: teamId!,
        page: { page, limit: pageSize },
        status,
      });

      return {
        requests: res.requests,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
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
