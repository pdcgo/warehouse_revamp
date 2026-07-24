import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderDraftClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The draft screens' reads and writes (#195/#196).
//
// A draft is PERSONAL as well as team-scoped: the server narrows every one of these to the caller,
// so there is nothing for the client to filter and nothing it could ask for that would widen it.

export function useOrderDrafts(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
  source?: string;
}) {
  const { teamId, page, pageSize, source = "" } = args;

  return useQuery({
    queryKey: key.orderDrafts(teamId, { page, pageSize, source }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderDraftClient.orderDraftList({
        teamId: teamId!,
        page: { page, limit: pageSize },
        source,
      });

      return {
        drafts: res.drafts,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

export function useOrderDraft(args: { teamId: bigint | undefined; draftId: bigint }) {
  const { teamId, draftId } = args;

  return useQuery({
    queryKey: key.orderDrafts(teamId, { draftId: draftId.toString() }),
    enabled: teamId !== undefined && draftId > 0n,
    queryFn: async () => {
      const res = await orderDraftClient.orderDraftDetail({ teamId: teamId!, draftId });

      return res.draft ?? null;
    },
  });
}

export function useInvalidateOrderDrafts() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["orderDrafts"] });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────

export function useUpdateOrderDraft() {
  const invalidate = useInvalidateOrderDrafts();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderDraftClient.orderDraftUpdate>[0]) =>
      orderDraftClient.orderDraftUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

// Bulk by design (#195): pruning is entirely manual — nothing expires — so the screen must be able
// to clear a selection in one action rather than one row at a time.
export function useDeleteOrderDrafts() {
  const invalidate = useInvalidateOrderDrafts();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderDraftClient.orderDraftDelete>[0]) =>
      orderDraftClient.orderDraftDelete(vars),
    onSuccess: () => invalidate(),
  });
}

// Promoting a draft creates an ORDER and destroys the draft, so it stales BOTH domains. Invalidating
// only drafts would leave the orders list without the order that was just created — the screen would
// not be wrong about anything it fetched, it simply fetched before the promotion.
export function usePromoteOrderDraft() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (vars: Parameters<typeof orderDraftClient.orderDraftPromote>[0]) =>
      orderDraftClient.orderDraftPromote(vars),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["orderDrafts"] });
      await client.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
