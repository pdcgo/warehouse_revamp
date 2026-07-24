import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierChannelClient, supplierClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import type { SupplierChannelType } from "../../gen/warehouse/inventory/v1/supplier_channel_pb";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// The supplier screens' reads (#176).

export function useSuppliers(args: {
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.suppliers(teamId, { q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await supplierClient.supplierList({
        teamId: teamId!,
        q,
        page: { page, limit: pageSize },
      });

      return {
        suppliers: res.suppliers,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
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

      return res.supplier ?? null;
    },
  });
}

// A supplier's channels. Kept as its OWN query rather than folded into useSupplier: the two failed
// independently before (a channel list error did not blank the supplier), and merging them would
// make one request's failure hide the other's result.
//
// Channels are few per supplier, so one large page covers them all and there is no pager.
export function useSupplierChannels(args: { teamId: bigint | undefined; supplierId: bigint }) {
  const { teamId, supplierId } = args;

  return useQuery({
    queryKey: key.suppliers(teamId, { supplierId: supplierId.toString(), channels: true }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async () => {
      const res = await supplierChannelClient.supplierChannelList({
        teamId: teamId!,
        supplierId,
        page: { page: 1, limit: 100 },
      });

      return res.channels;
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
//   - The two places that DO show a supplier's name outside this domain — SupplierSelect and
//     RestockRequestDetailPage's lookup — fetch it themselves in an effect and hold no query cache
//     entry, so there is nothing there to invalidate.
//
// A channel write invalidates the whole `suppliers` prefix rather than just the channel list, because
// the channels are read as part of the supplier: the detail page's two queries share the prefix, and
// splitting the invalidation would buy one avoided refetch in exchange for a rule to remember.

interface SaveSupplierVars {
  teamId: bigint;
  /** Set to correct an existing supplier; omitted to add one. */
  supplierId?: bigint;
  code: string;
  name: string;
  contact: string;
  province: string;
  city: string;
  address: string;
  description: string;
}

// Add or correct a supplier. One hook for both, because the edit form IS the record re-opened — the
// same reason SupplierFormDialog serves both.
export function useSaveSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: async ({ supplierId, ...vars }: SaveSupplierVars) =>
      supplierId === undefined
        ? await supplierClient.supplierCreate(vars)
        : await supplierClient.supplierUpdate({ ...vars, supplierId }),
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

interface SaveSupplierChannelVars {
  teamId: bigint;
  /**
   * The supplier the channel hangs off. Only sent on CREATE — an update names the channel directly,
   * and a channel never moves between suppliers, so the id is not part of an edit.
   */
  supplierId: bigint;
  /** Set to correct an existing channel; omitted to add one. */
  channelId?: bigint;
  type: SupplierChannelType;
  marketplace: Marketplace;
  name: string;
  url: string;
  contact: string;
  location: string;
}

export function useSaveSupplierChannel() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: async ({ channelId, supplierId, ...vars }: SaveSupplierChannelVars) =>
      channelId === undefined
        ? await supplierChannelClient.supplierChannelCreate({ ...vars, supplierId })
        : await supplierChannelClient.supplierChannelUpdate({ ...vars, channelId }),
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
