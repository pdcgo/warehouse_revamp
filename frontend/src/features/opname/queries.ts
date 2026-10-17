import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { opnameClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { OpnameRowStatus, OpnameSessionStatus } from "../../gen/warehouse/inventory/v1/opname_pb";
import { useInvalidateStock } from "../inventory/queries";
import { fetchActors } from "../users/queries";
import { racksFromList, rowsFromList, sessionsFromList } from "./adapt";

// The stock count's reads and writes (docs/business/inventory/opname.md). ⚠ A PROTOTYPE until design_accept: the
// server answers Unimplemented, and Storybook's stub (.storybook/opnameStub.ts) plays the decided rules.

const hasNextOf = (info: { currentPage: number; totalPage: number } | undefined) =>
  info ? info.currentPage < info.totalPage : false;

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function useOpnameSessions(args: {
  teamId: bigint | undefined;
  status: OpnameSessionStatus;
  page: number;
  pageSize: number;
}) {
  const { teamId, status, page, pageSize } = args;

  return useQuery({
    queryKey: key.opname(teamId, { sessions: "list", status, page, pageSize }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await opnameClient.opnameSessionList({
        teamId: teamId!,
        filter: { status },
        page: { page, limit: pageSize },
      });
      const sessions = sessionsFromList(res.items, res.ids);
      // Who planned and who finalized each, resolved once for the page.
      const actors = await fetchActors(sessions.flatMap((s) => [s.createdById, s.finalizedById]));

      return { sessions, actors, hasNext: hasNextOf(res.pageInfo) };
    },
  });
}

/** The warehouse's active session, if any — there is at most one (one-active-count-per-warehouse). */
export function useActiveOpnameSession(teamId: bigint | undefined) {
  return useQuery({
    queryKey: key.opname(teamId, { sessions: "active" }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await opnameClient.opnameSessionList({
        teamId: teamId!,
        filter: { status: OpnameSessionStatus.ACTIVE },
        page: { page: 1, limit: 1 },
      });

      return sessionsFromList(res.items, res.ids)[0] ?? null;
    },
  });
}

export function useOpnameSession(args: { teamId: bigint | undefined; sessionId: bigint }) {
  const { teamId, sessionId } = args;

  return useQuery({
    queryKey: key.opname(teamId, { session: sessionId.toString() }),
    enabled: teamId !== undefined && sessionId > 0n,
    queryFn: async () => {
      const res = await opnameClient.opnameSessionDetail({ teamId: teamId!, sessionId });
      const session = res.session ?? null;
      const actors = await fetchActors(session ? [session.createdById, session.finalizedById] : []);

      return { session, actors };
    },
  });
}

export interface OpnameRowArgs {
  teamId: bigint | undefined;
  sessionId: bigint;
  placementId: bigint;
  status: OpnameRowStatus;
  onlyDifferences: boolean;
  q: string;
  page: number;
  pageSize: number;
}

/** The admin's rows — with the book figure. Never for staff (OpnameRowList is refused to them). */
export function useOpnameRows(args: OpnameRowArgs) {
  const { teamId, sessionId, placementId, status, onlyDifferences, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.opname(teamId, {
      rows: sessionId.toString(),
      placementId: placementId.toString(),
      status,
      onlyDifferences,
      q,
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined && sessionId > 0n,
    queryFn: async () => {
      const res = await opnameClient.opnameRowList({
        teamId: teamId!,
        filter: { sessionId, placementId, status, onlyDifferences, q },
        page: { page, limit: pageSize },
      });
      const rows = rowsFromList(res.items, res.ids);
      const actors = await fetchActors(rows.map((r) => r.countedById));

      return { rows, actors, hasNext: hasNextOf(res.pageInfo) };
    },
  });
}

export function useOpnameRacks(args: { teamId: bigint | undefined; sessionId: bigint; q: string; page: number; pageSize: number }) {
  const { teamId, sessionId, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.opname(teamId, { racks: sessionId.toString(), q, page, pageSize }),
    ...listQuery,
    enabled: teamId !== undefined && sessionId > 0n,
    queryFn: async () => {
      const res = await opnameClient.opnameRackList({
        teamId: teamId!,
        filter: { sessionId, q },
        page: { page, limit: pageSize },
      });

      return { racks: racksFromList(res.items, res.ids), hasNext: hasNextOf(res.pageInfo) };
    },
  });
}

/** One rack as its counter sees it — blind until each row is counted. */
export function useOpnameRackCount(args: { teamId: bigint | undefined; sessionId: bigint; placementId: bigint }) {
  const { teamId, sessionId, placementId } = args;

  return useQuery({
    queryKey: key.opname(teamId, { rackCount: sessionId.toString(), placementId: placementId.toString() }),
    enabled: teamId !== undefined && sessionId > 0n && placementId > 0n,
    queryFn: async () => {
      const res = await opnameClient.opnameRackCount({ teamId: teamId!, sessionId, placementId });

      return { rack: res.rack ?? null, rows: res.rows };
    },
  });
}

export function useOpnameFinalizePreview(args: { teamId: bigint | undefined; sessionId: bigint }) {
  const { teamId, sessionId } = args;

  return useQuery({
    queryKey: key.opname(teamId, { finalize: sessionId.toString() }),
    enabled: teamId !== undefined && sessionId > 0n,
    queryFn: () => opnameClient.opnameFinalizePreview({ teamId: teamId!, sessionId }),
  });
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Every write refreshes the whole count — a row counted on a phone moves the admin's progress. FINALIZE moves stock, so
// it refreshes the stock screens too.

function useInvalidateOpname() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["opname"] });
}

export function useCreateOpnameSession() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameSessionCreate>[0]) => opnameClient.opnameSessionCreate(vars),
    onSuccess: () => invalidate(),
  });
}

export function useCancelOpnameSession() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameSessionCancel>[0]) => opnameClient.opnameSessionCancel(vars),
    onSuccess: () => invalidate(),
  });
}

export function useSendBackOpnameRow() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameRowSendBack>[0]) => opnameClient.opnameRowSendBack(vars),
    onSuccess: () => invalidate(),
  });
}

export function useFinalizeOpnameSession() {
  const invalidate = useInvalidateOpname();
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameSessionFinalize>[0]) => opnameClient.opnameSessionFinalize(vars),
    onSuccess: () => Promise.all([invalidate(), invalidateStock()]),
  });
}

export function useCountOpnameRow() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameRowCount>[0]) => opnameClient.opnameRowCount(vars),
    onSuccess: () => invalidate(),
  });
}

export function useMarkOpnameRowCounted() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameRowMarkCounted>[0]) => opnameClient.opnameRowMarkCounted(vars),
    onSuccess: () => invalidate(),
  });
}

export function useAddFoundOpnameRow() {
  const invalidate = useInvalidateOpname();

  return useMutation({
    mutationFn: (vars: Parameters<typeof opnameClient.opnameRowAddFound>[0]) => opnameClient.opnameRowAddFound(vars),
    onSuccess: () => invalidate(),
  });
}
