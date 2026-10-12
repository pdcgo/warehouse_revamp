import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shipmentChannelClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import { invalidateShippingCatalogue } from "../shipping/catalogue";
import { channelByIdsRowData, channelListRowData, channelsFromByIds, channelsFromList } from "./adapt";

// The courier catalogue — docs/business/shipment/context_decision.md.
//
// GLOBAL reference data: the same channels for every team, so no team goes in the key. Every read is
// public (the-channel-list-needs-no-login, by-ids-is-public-too); every write is root's.

// The MANAGEMENT list — root browsing, searching and restoring. `includeDeleted` is in the key: the
// picker asks for live channels only, and the two answers must never share an entry.
export function useShipmentChannels(args: { q: string; includeDeleted: boolean; page: number; pageSize: number }) {
  const { q, includeDeleted, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.shipmentChannels({ q, includeDeleted, page, pageSize }),
    queryFn: async () => {
      const res = await shipmentChannelClient.shipmentChannelList({
        filter: { q, includeDeleted },
        dataRequest: channelListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        channels: channelsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The PICKER feed — live channels only. One large first page: the list is a handful of couriers, and
// the List shape still pages, so the picker simply asks for enough.
export function useShipmentChannelOptions() {
  return useQuery({
    ...referenceQuery,
    queryKey: key.shipmentChannels({ options: true }),
    queryFn: async () => {
      const res = await shipmentChannelClient.shipmentChannelList({
        filter: { includeDeleted: false },
        dataRequest: channelListRowData(),
        page: { page: 1, limit: 200 },
      });

      return channelsFromList(res.items, res.ids);
    },
  });
}

// Name lookup for ids a screen already holds — an order's shipment_channel_id. Deleted channels come
// back flagged, so an old order still names its courier.
export function useShipmentChannelsByIds(channelIds: bigint[]) {
  const ids = [...new Set(channelIds.filter((id) => id > 0n))].sort();

  return useQuery({
    ...referenceQuery,
    queryKey: key.shipmentChannels({ byIds: ids.map(String).join(",") }),
    enabled: ids.length > 0,
    queryFn: async () => {
      const res = await shipmentChannelClient.shipmentChannelByIds({
        filter: { ids },
        dataRequest: channelByIdsRowData(),
      });

      return channelsFromByIds(res);
    },
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────
//
// Each drops the whole `shipmentChannels` prefix — the management list, the picker feed AND the by-id
// lookups — because a rename, a delete and a restore each change what all three show. The hook owns
// the cache; the component owns the toast and the dialog.

export function useInvalidateShipmentChannels() {
  const client = useQueryClient();

  return () => {
    // The session cache ShippingSelect and every ShippingBadge read (the code bridge) — dropped with the
    // query, or a rename lingers in every badge until reload.
    invalidateShippingCatalogue();

    return client.invalidateQueries({ queryKey: ["shipmentChannels"] });
  };
}

export function useCreateShipmentChannel() {
  const invalidate = useInvalidateShipmentChannels();

  return useMutation({
    mutationFn: (vars: { code: string; name: string; desc: string }) =>
      shipmentChannelClient.shipmentChannelCreate(vars),
    onSuccess: () => invalidate(),
  });
}

// Name and desc only — there is no code to send (a-code-never-changes).
export function useUpdateShipmentChannel() {
  const invalidate = useInvalidateShipmentChannels();

  return useMutation({
    mutationFn: (vars: { channelId: bigint; name: string; desc: string }) =>
      shipmentChannelClient.shipmentChannelUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteShipmentChannel() {
  const invalidate = useInvalidateShipmentChannels();

  return useMutation({
    mutationFn: (vars: { channelId: bigint }) => shipmentChannelClient.shipmentChannelDelete(vars),
    onSuccess: () => invalidate(),
  });
}

export function useRestoreShipmentChannel() {
  const invalidate = useInvalidateShipmentChannels();

  return useMutation({
    mutationFn: (vars: { channelId: bigint }) => shipmentChannelClient.shipmentChannelRestore(vars),
    onSuccess: () => invalidate(),
  });
}
