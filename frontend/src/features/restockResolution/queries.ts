import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";

import { customShipmentClient, restockClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { CustomShipmentDirection } from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { useInvalidateStock } from "../inventory/queries";
import { supplierByIdsRowData, suppliersFromByIds } from "../suppliers/adapt";
import type { InboundParcel, InboundStatus } from "./resolutions";
import { inboundFromWire, isInbound, wireInboundStatus } from "./resolutions";

// THE RESTOCK RESOLUTIONS' READS AND WRITES (backlog #101, live since the-restock-resolutions-prototype-is-accepted) — the
// phase-1 RPCs (resolutions.ts heads them). The resolution rows and the settled mark ride the restock's own reads
// (features/restock/queries.ts: RestockRequestDetail carries the rows, the list the count and the mark); the inbound
// parcels are custom shipments, read here under the `customShipments` key so a parcel's move refreshes Kirim Paket too.
//
// WHAT EACH WRITE MAKES STALE: a resolution or the settle → the restock (its rows, its mark, its tags — the problem list
// and the Hilang tab) and the parcels (a reshipping CREATES one); an inbound parcel's move → the parcels; its Terima →
// the parcels, the restock (a short or broken count REOPENS it, 🔄 A) and the stock (its good units go on a rack).

const notFound = (err: unknown) => err instanceof ConnectError && err.code === Code.NotFound;

/**
 * The parcels' supplier names, resolved in the SAME read that fetched them (as the reship choices resolve theirs —
 * customShipment/queries.ts `useReshipOptions`): SupplierByIds, once for the page; unscoped, so the warehouse reads the
 * name too. A supplier the read cannot name keeps "" (the screen says *Supplier*).
 */
export async function withSupplierNames(teamId: bigint, parcels: InboundParcel[]): Promise<InboundParcel[]> {
  const ids = [...new Set(parcels.map((p) => p.supplierId).filter((id) => id > 0n))];
  if (ids.length === 0) return parcels;

  const suppliers = await supplierClient
    .supplierByIds({ teamId, filter: { ids }, dataRequest: supplierByIdsRowData() })
    .then(suppliersFromByIds);

  return parcels.map((p) => ({ ...p, supplierName: suppliers.get(p.supplierId.toString())?.name ?? "" }));
}

/** One inbound parcel as the current team may read it — null on NotFound, or when the id is an outbound parcel. */
export function inboundParcelQuery(teamId: bigint | undefined, id: bigint) {
  return {
    queryKey: key.customShipments(teamId, { inbound: id.toString() }),
    enabled: teamId !== undefined && id > 0n,
    queryFn: async (): Promise<InboundParcel | null> => {
      try {
        const res = await customShipmentClient.customShipmentDetail({ teamId: teamId!, id });
        const wire = res.customShipment;
        if (!wire || !isInbound(wire)) return null;
        const [parcel] = await withSupplierNames(teamId!, [inboundFromWire(wire)]);

        return parcel ?? null;
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },
  };
}

export function useInboundParcel(args: { teamId: bigint | undefined; id: bigint }) {
  return useQuery(inboundParcelQuery(args.teamId, args.id));
}

/** Several inbound parcels at once — a restock's reshipping rows, each its own read (deduped with useInboundParcel). */
export function useInboundParcelsById(teamId: bigint | undefined, ids: bigint[]): Map<string, InboundParcel> {
  const results = useQueries({ queries: ids.map((id) => inboundParcelQuery(teamId, id)) });
  const out = new Map<string, InboundParcel>();
  results.forEach((r, i) => {
    if (r.data) out.set(ids[i]!.toString(), r.data);
  });

  return out;
}

/**
 * THE WAREHOUSE'S INCOMING PARCELS — `direction` INBOUND (a warehouse sees the parcels coming in only when it asks for
 * them; its Kirim Paket queue stays what it ships), narrowed to the status tab's step and the list's search, PAGED on
 * the restock list's own page and size (HARD RULE 9): page N of the parcels sits on top of page N of the restocks, so
 * every parcel is reached by the one pager.
 */
export function useIncomingParcels(args: {
  teamId: bigint | undefined;
  status: InboundStatus | undefined;
  q: string;
  page: number;
  pageSize: number;
  enabled: boolean;
}) {
  const { teamId, status, q, page, pageSize, enabled } = args;

  return useQuery({
    queryKey: key.customShipments(teamId, { incoming: true, status: status ?? "", q, page, pageSize }),
    ...listQuery,
    enabled: enabled && teamId !== undefined,
    queryFn: async () => {
      const res = await customShipmentClient.customShipmentList({
        teamId: teamId!,
        filter: { direction: CustomShipmentDirection.INBOUND, status: wireInboundStatus(status), q },
        page: { page, limit: pageSize },
      });
      const parcels = await withSupplierNames(teamId!, res.customShipments.filter(isInbound).map(inboundFromWire));

      return { parcels, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function useInvalidateResolutions() {
  const client = useQueryClient();

  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["restock"] }),
      client.invalidateQueries({ queryKey: ["customShipments"] }),
    ]);
  };
}

/** *Catat Resolusi* — one row: a REFUND, or a RESHIPPING with the inbound parcel it creates in the same step. */
export function useRecordResolution() {
  const invalidate = useInvalidateResolutions();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockResolutionCreate>[0]) => restockClient.restockResolutionCreate(vars),
    onSettled: () => invalidate(),
  });
}

/** *Tandai Selesai* — the settled mark, the problem tags off. */
export function useSettleRestock() {
  const invalidate = useInvalidateResolutions();

  return useMutation({
    mutationFn: (vars: Parameters<typeof restockClient.restockRequestSettle>[0]) => restockClient.restockRequestSettle(vars),
    onSettled: () => invalidate(),
  });
}

function useInvalidateParcels() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["customShipments"] });
}

export function useSetInboundResi() {
  const invalidate = useInvalidateParcels();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentResiSet>[0]) => customShipmentClient.customShipmentResiSet(vars),
    onSettled: () => invalidate(),
  });
}

export function useSetInboundPrices() {
  const invalidate = useInvalidateParcels();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentPricesSet>[0]) =>
      customShipmentClient.customShipmentPricesSet(vars),
    onSettled: () => invalidate(),
  });
}

export function useMarkInboundLost() {
  const invalidate = useInvalidateParcels();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentMarkLost>[0]) =>
      customShipmentClient.customShipmentMarkLost(vars),
    onSettled: () => invalidate(),
  });
}

export function useArriveInbound() {
  const invalidate = useInvalidateParcels();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentArrive>[0]) => customShipmentClient.customShipmentArrive(vars),
    onSettled: () => invalidate(),
  });
}

/** *Terima* — the good units on a rack (stock), broken and short written down; a short or broken count reopens the restock. */
export function useReceiveInbound() {
  const invalidate = useInvalidateResolutions();
  const invalidateStock = useInvalidateStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentReceive>[0]) => customShipmentClient.customShipmentReceive(vars),
    onSettled: async () => {
      await Promise.all([invalidate(), invalidateStock()]);
    },
  });
}
