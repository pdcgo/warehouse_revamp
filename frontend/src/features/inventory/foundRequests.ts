import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { foundRequestClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  type FoundRequest,
  FoundRequestListDataType,
  type FoundRequestListResponse,
  FoundRequestStatus,
} from "../../gen/warehouse/inventory/v1/found_request_pb";
import { fetchActors } from "../users/queries";
import { useInvalidateStock } from "./queries";

// A unit FOUND at the shelf outside a stock count waits for the warehouse Owner or Admin
// (an-adjust-found-waits-for-the-owner-or-admin): the Adjust dialog's found — and staff's Report Found on the rack page
// (staff-may-report-a-found) — writes a request through FoundRequestCreate, and the approval list decides it. Served by
// FoundRequestService; Storybook's stub (.storybook/foundRequestStub.ts) plays the same rules.
//
// Everything here lives under `key.foundRequests`, so a report, an approval, a rejection or a withdrawal — and a stock
// count's finalize, which settles the requests it counted (a-count-settles-the-found-it-counted) — refreshes the list
// AND the menu's count of the waiting ones together.

const hasNextOf = (info: { currentPage: number; totalPage: number } | undefined) =>
  info ? info.currentPage < info.totalPage : false;

export function foundRequestsFromList(res: FoundRequestListResponse): FoundRequest[] {
  let m: { [k: string]: FoundRequest } = {};
  for (const it of res.items) if (it.d.case === "request") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter((r): r is FoundRequest => r !== undefined);
}

/** The warehouse's found requests of one status (UNSPECIFIED = every one), newest report first — with the people named. */
export function useFoundRequests(args: {
  teamId: bigint | undefined;
  status: FoundRequestStatus;
  page: number;
  pageSize: number;
}) {
  const { teamId, status, page, pageSize } = args;

  return useQuery({
    queryKey: key.foundRequests(teamId, { status, page, pageSize }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await foundRequestClient.foundRequestList({
        teamId: teamId!,
        filter: { status },
        dataRequest: [FoundRequestListDataType.REQUEST],
        page: { page, limit: pageSize },
      });
      const requests = foundRequestsFromList(res);
      // Who reported and who decided each, resolved once for the page.
      const actors = await fetchActors(requests.flatMap((r) => [r.reportedById, r.decidedById]));

      return { requests, actors, hasNext: hasNextOf(res.pageInfo) };
    },
  });
}

/**
 * THE MENU'S COUNT — the warehouse's WAITING found requests (found-stock-sits-after-stock-opname-with-its-count), read
 * as Kewajiban's is: the whole-set total of a one-row page, the general row only so no preview is worked out. Under
 * `key.foundRequests`, so every write here and a count's finalize refresh it.
 */
export function useFoundWaitingCount(teamId: bigint | undefined, enabled: boolean) {
  return useQuery({
    queryKey: key.foundRequests(teamId, { waitingCount: true }),
    enabled: enabled && teamId !== undefined,
    queryFn: async () => {
      const res = await foundRequestClient.foundRequestList({
        teamId: teamId!,
        filter: { status: FoundRequestStatus.WAITING },
        dataRequest: [FoundRequestListDataType.GENERAL],
        page: { page: 1, limit: 1 },
      });

      return Number(res.pageInfo?.totalItems ?? 0n);
    },
  });
}

/**
 * An approval posts a `found` transaction — stock moves, so the stock reads (the warehouse product and batch pages, the
 * racks) refresh with the list; a claim gives the owner's reimbursement back, so the liability reads do too.
 */
export function useApproveFoundRequest() {
  const client = useQueryClient();
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; foundRequestId: bigint }) => foundRequestClient.foundRequestApprove(vars),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["foundRequests"] }),
        client.invalidateQueries({ queryKey: ["liability"] }),
        invalidateStock(),
      ]);
    },
  });
}

/** A rejection — or the reporter's withdrawal — posts nothing: only the list and the menu's count change. */
export function useRejectFoundRequest() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; foundRequestId: bigint; reason: string }) =>
      foundRequestClient.foundRequestReject(vars),
    onSuccess: () => client.invalidateQueries({ queryKey: ["foundRequests"] }),
  });
}

/**
 * A found, reported: FoundRequestCreate — no batch. It posts nothing, so no stock read changes — only the approval list
 * and the menu's count do.
 */
export function useReportFound() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (vars: Parameters<typeof foundRequestClient.foundRequestCreate>[0]) =>
      foundRequestClient.foundRequestCreate(vars),
    onSuccess: () => client.invalidateQueries({ queryKey: ["foundRequests"] }),
  });
}
