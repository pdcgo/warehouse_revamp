import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierChannelClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { SortState } from "../../components/chrome/SortableHeader";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import { SupplierListScope, SupplierRowSort } from "../../gen/warehouse/supplier/v1/supplier_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import {
  type ChannelFields,
  type SupplierChannelRecord,
  type SupplierFields,
  type SupplierRecord,
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
  supplierChannelsFromList,
  supplierListWithChannelsData,
} from "./adapt";

// The supplier screens' reads (#176), against supplier_service (warehouse.supplier.v1). Every one returns
// `SupplierRecord` / `SupplierChannelRecord` through the mapper in adapt.ts, so no screen sees the proto.
//
// READS CROSS TEAMS, WRITES DO NOT. SupplierDetail and SupplierChannelList answer for ANY team's live
// supplier (another-team-sees-everything-of-a-supplier); a write answers NotFound for anything but the
// caller's own team's. So a screen that reads a supplier decides for itself whether it may offer to edit it
// — by comparing the supplier's `teamId` with the current team.
//
// `teamId` on every hook is the CALLER's team — the authorization scope — not the team whose supplier comes
// back, and it stays in every key: the same request can be answerable for one caller and refused for
// another, and caching them together would leak one team's answer to the other.

// The suppliers THIS team keeps — the My Supplier page, and the restock form's picker. Another team's are
// Discover's question (features/suppliers/discover.ts).
/** A row of the team's own list: the supplier and its live stores (the list's CHANNELS slice). */
export interface ManagedSupplier extends SupplierRecord {
  channels: SupplierChannelRecord[];
}

export type SupplierSortKey = "name";

export function useSuppliers(args: {
  teamId: bigint | undefined;
  q: string;
  /** `UNSPECIFIED` = any; otherwise suppliers with at least one live store of this type. */
  channelType?: Marketplace;
  /** `null` = the list's own order, newest first; otherwise by name, A to Z or back (the server sorts). */
  sort?: SortState<SupplierSortKey> | null;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;
  const channelType = args.channelType ?? Marketplace.UNSPECIFIED;
  const sort = args.sort ?? null;

  return useQuery({
    // A search, a filter, a sort and a page refine the same question, so the previous rows stay up while it runs
    // (HARD RULE 10). The page wraps its table in a RefreshOverlay for the same reason.
    ...listQuery,
    queryKey: key.suppliers(teamId, { q, channelType, sort: sort ? `${sort.by}:${sort.dir}` : "", page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await supplierClient.supplierList({
        teamId: teamId!,
        filter: { q, scope: SupplierListScope.OWN, channelType },
        sort: sort
          ? {
              sortType: sort.dir === "asc" ? CommonSortType.ASC : CommonSortType.DESC,
              s: { case: "supplier", value: SupplierRowSort.NAME },
            }
          : undefined,
        // The rows AND each supplier's live stores — the list shows them as badges, as Discover does.
        dataRequest: supplierListWithChannelsData(),
        page: { page, limit: pageSize },
      });

      const channels = supplierChannelsFromList(res.items);
      const suppliers: ManagedSupplier[] = suppliersFromList(res.items, res.ids).map((s) => ({
        ...s,
        channels: channels.get(s.id.toString()) ?? [],
      }));

      return { suppliers, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

// Suppliers by id, for a caller that already HOLDS the ids — a restock naming its vendor.
//
// Distinct from useSupplier, and the difference is the point: SupplierDetail answers a LIVE supplier only,
// so a restock whose vendor was deleted since would read "Supplier #2". SupplierByIds returns it anyway,
// marked `deleted` (a-deleted-supplier-is-kept-for-its-figures) — whoever keeps it — which is what lets the
// crew accepting a delivery name the vendor printed on the carton in front of them.
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

// One LIVE supplier, whichever team keeps it — the manage detail and the discover detail read the same
// record. A deleted or unknown id is NotFound.
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

// A supplier's WHOLE store list, in one large page — the 200 the contract allows. Kept for the Products tab:
// its sample rows (sampleProducts.ts) are made from every store, not from the window the Channels tab shows.
// A supplier has a handful of stores, so the cap is not reached in practice.
//
// Kept as its OWN query rather than folded into useSupplier: the two fail independently (a store-list error
// does not blank the supplier), and merging them would make one request's failure hide the other's result.
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

// ONE PAGE of a supplier's stores, searched and filtered ON THE SERVER — the Channels tab
// (the-channels-tab-searches-filters-and-pages). `q` matches the name, the link and the description;
// `channelType` UNSPECIFIED is every type.
export function useSupplierChannelPage(args: {
  teamId: bigint | undefined;
  supplierId: bigint;
  q: string;
  channelType: Marketplace;
  page: number;
  pageSize: number;
}) {
  const { teamId, supplierId, q, channelType, page, pageSize } = args;

  return useQuery({
    // A search, a type and a page refine the same question (HARD RULE 10) — the browser keeps the rows up
    // behind its RefreshOverlay while the next answer loads.
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      supplierId: supplierId.toString(),
      channelsPaged: true,
      q,
      channelType,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async () => {
      const res = await supplierChannelClient.supplierChannelList({
        teamId: teamId!,
        filter: { supplierId, q, channelType },
        dataRequest: supplierChannelRowData(),
        page: { page, limit: pageSize },
      });

      return {
        channels: channelsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
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
//   - The restock screens DO cache one, but through `useSuppliersByIds` above — so it sits under this
//     same `suppliers` prefix and a rename already reaches it.
//
// A channel write invalidates the whole `suppliers` prefix rather than just the channel list, because
// the channels are read as part of the supplier: the detail page's queries share the prefix, and
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

// SOFT (a-deleted-supplier-is-kept-for-its-figures): the supplier leaves every list and picker, and a past
// restock still reads its name through SupplierByIds.
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

// SOFT too (a-store-delete-is-soft-too): the store leaves the Channels tab; a restock line still finds it.
export function useDeleteSupplierChannel() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; channelId: bigint }) =>
      supplierChannelClient.supplierChannelDelete(vars),
    onSuccess: () => invalidate(),
  });
}
