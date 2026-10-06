import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierChannelClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  type ChannelFields,
  type SupplierFields,
  channelCreateRequest,
  channelUpdateRequest,
  channelsFromList,
  supplierCreateRequest,
  supplierRecord,
  supplierUpdateRequest,
  suppliersFromByIds,
  suppliersFromList,
  supplierByIdsRowData,
  supplierChannelRowData,
  supplierListRowData,
} from "./adapt";

// The supplier screens' reads (#176). Every one returns the DECIDED shape — `SupplierRecord`,
// `SupplierChannelRecord` — through the translation step in adapt.ts, so no screen sees the old proto.

export function useSuppliers(args: {
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;

  return useQuery({
    // A search and a page refine the same question, so the previous rows stay up while it runs
    // (HARD RULE 10). The page wraps its table in a RefreshOverlay for the same reason.
    ...listQuery,
    queryKey: key.suppliers(teamId, { q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await supplierClient.supplierList({
        teamId: teamId!,
        filter: { q },
        dataRequest: supplierListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        suppliers: suppliersFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Suppliers by id, for a caller that already HOLDS the ids — a restock naming its vendor.
//
// Distinct from useSupplier, and the difference is the point: SupplierDetail filters by the caller's
// team, so a WAREHOUSE asking about the selling team's supplier gets NotFound and the screen shows
// "Supplier #2". SupplierByIds does not filter by team, which is what lets the crew accepting a
// delivery name the vendor printed on the carton in front of them.
//
// `teamId` here is the CALLER's team — the authorization scope — not the team whose suppliers come
// back, so it stays in the query key: the same id can be answerable for one caller and refused for
// another, and caching them together would leak one team's answer to the other.
export function useSuppliersByIds(args: { teamId: bigint | undefined; supplierIds: bigint[] }) {
  const { teamId } = args;
  const supplierIds = [...new Set(args.supplierIds.filter((id) => id > 0n))].sort();

  return useQuery({
    queryKey: key.suppliers(teamId, { byIds: supplierIds.map(String).join(",") }),
    enabled: teamId !== undefined && supplierIds.length > 0,
    queryFn: async () => {
      const res = await supplierClient.supplierByIds({
        teamId: teamId!,
        filter: { ids: supplierIds },
        dataRequest: supplierByIdsRowData(),
      });

      return suppliersFromByIds(res);
    },
  });
}

export function useSupplier(args: { teamId: bigint | undefined; supplierId: bigint }) {
  const { teamId, supplierId } = args;

  return useQuery({
    queryKey: key.suppliers(teamId, { supplierId: supplierId.toString() }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async () => {
      const res = await supplierClient.supplierDetail({ teamId: teamId!, supplierId });

      return res.supplier ? supplierRecord(res.supplier) : null;
    },
  });
}

// A supplier's channels. Kept as its OWN query rather than folded into useSupplier: the two failed
// independently before (a channel list error did not blank the supplier), and merging them would
// make one request's failure hide the other's result.
//
// Channels are few per supplier, so one large page — the 200 the contract allows — reads them all. The Products
// tab's sample rows are made from this whole list, and the Channels tab's ChannelBrowser pages it.
export function useSupplierChannels(args: { teamId: bigint | undefined; supplierId: bigint }) {
  const { teamId, supplierId } = args;

  return useQuery({
    queryKey: key.suppliers(teamId, { supplierId: supplierId.toString(), channels: true }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async () => {
      const res = await supplierChannelClient.supplierChannelList({
        teamId: teamId!,
        filter: { supplierId },
        dataRequest: supplierChannelRowData(),
        page: { page: 1, limit: 200 },
      });

      return channelsFromList(res.items, res.ids);
    },
  });
}

// Covers the list, the detail and the channels — they share the `suppliers` domain, and a channel
// write is a change to the supplier as the user understands it.
export function useInvalidateSuppliers() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["suppliers"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale — see
// src/expenses/queries.ts for the full argument. In this domain it also removes a duplication: the
// list page, the detail page and both dialogs each wired their own `onDone`, so four places had to
// agree about what a supplier write makes stale, and only three of them were even looking at the
// channels.
//
// The split is deliberate: the hook owns the CACHE, the component owns the UX (the toast, closing the
// dialog, showing the error). `onSuccess` RETURNS the invalidation promise so TanStack awaits it and
// the dialog does not close a beat before the row appears.
//
// ONLY `suppliers` is invalidated by any of these, and that is worth stating because a supplier looks
// like it should reach further. It does not:
//
//   - A RestockRequest stores `supplier_id` alone (restock_request.proto) — no denormalised name — so
//     renaming a supplier cannot stale a cached restock row.
//   - SupplierSelect, which shows a supplier's name outside this domain, fetches it itself in an
//     effect and holds no query cache entry, so there is nothing there to invalidate.
//   - The selling restock detail DOES cache one, but through `useSupplier` above — so it sits under
//     this same `suppliers` prefix and a rename already reaches it.
//
// A channel write invalidates the whole `suppliers` prefix rather than just the channel list, because
// the channels are read as part of the supplier: the detail page's two queries share the prefix, and
// splitting the invalidation would buy one avoided refetch in exchange for a rule to remember.

interface SaveSupplierVars extends SupplierFields {
  teamId: bigint;
  /** Set to correct an existing supplier; omitted to add one. */
  supplierId?: bigint;
}

// Add or correct a supplier. One hook for both, because the edit form IS the record re-opened — the
// same reason SupplierFormDialog serves both.
export function useSaveSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: async ({ teamId, supplierId, ...fields }: SaveSupplierVars) =>
      supplierId === undefined
        ? await supplierClient.supplierCreate(supplierCreateRequest(teamId, fields))
        : await supplierClient.supplierUpdate(supplierUpdateRequest(teamId, supplierId, fields)),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; supplierId: bigint }) => supplierClient.supplierDelete(vars),
    onSuccess: () => invalidate(),
  });
}

interface SaveSupplierChannelVars extends ChannelFields {
  teamId: bigint;
  /**
   * The supplier the channel hangs off. Only sent on CREATE — an update names the channel directly,
   * and a channel never moves between suppliers, so the id is not part of an edit.
   */
  supplierId: bigint;
  /** Set to correct an existing channel; omitted to add one. */
  channelId?: bigint;
}

export function useSaveSupplierChannel() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: async ({ teamId, channelId, supplierId, ...fields }: SaveSupplierChannelVars) =>
      channelId === undefined
        ? await supplierChannelClient.supplierChannelCreate(channelCreateRequest(teamId, supplierId, fields))
        : await supplierChannelClient.supplierChannelUpdate(channelUpdateRequest(teamId, channelId, fields)),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteSupplierChannel() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; channelId: bigint }) =>
      supplierChannelClient.supplierChannelDelete(vars),
    onSuccess: () => invalidate(),
  });
}
