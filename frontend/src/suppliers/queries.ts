import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierChannelClient, supplierClient } from "../api/clients";
import { key } from "../api/queryClient";

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
