import { useQuery, useQueryClient } from "@tanstack/react-query";
import { restockClient } from "../api/clients";
import { key } from "../api/queryClient";
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
