import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";

import { customShipmentClient, inventoryClient, supplierChannelClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import { supplierByIdsRowData, suppliersFromByIds } from "../suppliers/adapt";
import type { CustomShipment, CustomShipmentKind, CustomShipmentPick, CustomShipmentStatus, ReshipOption } from "./customShipments";
import { customShipmentFromWire, reshipOptionFromWire, wireKind, wireStatus } from "./adapt";

// THE CUSTOM SHIPMENTS' READS AND WRITES — inventory_service's CustomShipmentService (backlog #88), for the five accepted
// screens (the-custom-shipments-prototype-is-accepted). Every read is the current team's: the server answers the selling
// team its own parcels, the warehouse the ones it ships — with no seller money (a-warehouse-sees-no-seller-money) — and
// another team NotFound. Keyed under ONE prefix, `customShipments`, so a move refreshes the list, the detail and the
// reship choices together.

export interface CustomShipmentListArgs {
  teamId: bigint | undefined;
  status?: CustomShipmentStatus;
  kind?: CustomShipmentKind;
  /** The selling list's warehouse lens — 0 = every warehouse. */
  warehouseId: bigint;
  /**
   * Free text over the number, the recipient and a line's product — sent AS TYPED, however short: the server answers a
   * one- or two-letter term too (a-product-picker-needs-no-two-letters' spirit; rpc.md, the list's volume table).
   */
  q: string;
  page: number;
  pageSize: number;
}

export function useCustomShipments(args: CustomShipmentListArgs) {
  const { teamId, status, kind, warehouseId, q, page, pageSize } = args;

  return useQuery({
    // EVERY filter is the server's (the list is paged), so every one is in the key.
    queryKey: key.customShipments(teamId, {
      list: true,
      status: status ?? "",
      kind: kind ?? "",
      warehouseId: warehouseId.toString(),
      q,
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await customShipmentClient.customShipmentList({
        teamId: teamId!,
        filter: { status: wireStatus(status), kind: wireKind(kind), q, warehouseId },
        page: { page, limit: pageSize },
      });

      return {
        shipments: res.customShipments.map(customShipmentFromWire),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

const notFound = (err: unknown) => err instanceof ConnectError && err.code === Code.NotFound;

/** One parcel as the current team may read it — `null` when the server says NotFound (another team's, another warehouse's). */
export function useCustomShipment(args: { teamId: bigint | undefined; id: bigint }) {
  const { teamId, id } = args;

  return useQuery({
    queryKey: key.customShipments(teamId, { id: id.toString() }),
    enabled: teamId !== undefined && id > 0n,
    queryFn: async (): Promise<CustomShipment | null> => {
      try {
        const res = await customShipmentClient.customShipmentDetail({ teamId: teamId!, id });

        return res.customShipment ? customShipmentFromWire(res.customShipment) : null;
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },
  });
}

// THE WAREHOUSE'S PICK PAGE — the parcel and the racks its sample's take drew, fetched TOGETHER as the order pick page's
// read (features/picking `usePickOrder`): the lines are useless without the shelves. The racks are the take's
// (StockPickLocations by the parcel's `transaction_id`, in this warehouse); a reship took nothing, so it asks none.
export function useCustomShipmentPick(args: { warehouseId: bigint | undefined; id: bigint }) {
  const { warehouseId, id } = args;

  return useQuery({
    queryKey: key.customShipments(warehouseId, { pick: id.toString() }),
    enabled: warehouseId !== undefined && id > 0n,
    queryFn: async (): Promise<{ shipment: CustomShipment | null; picks: CustomShipmentPick[] }> => {
      let shipment: CustomShipment | null = null;
      try {
        const res = await customShipmentClient.customShipmentDetail({ teamId: warehouseId!, id });
        shipment = res.customShipment ? customShipmentFromWire(res.customShipment) : null;
      } catch (err) {
        if (notFound(err)) return { shipment: null, picks: [] };
        throw err;
      }

      const transactionId = shipment?.transactionId ?? 0n;
      const places =
        shipment?.kind === "SAMPLE" && transactionId > 0n
          ? await inventoryClient.stockPickLocations({ warehouseId: warehouseId!, transactionId })
          : { locations: [] };

      return {
        shipment,
        picks: places.locations.map((loc) => ({
          productId: loc.productId,
          rackId: loc.rackId,
          rackCode: loc.rackCode,
          quantity: BigInt(loc.quantity),
        })),
      };
    },
  });
}

// WHAT A RESHIP CAN SEND — the team's received restocks with broken units still free, newest accept first. The accepted
// form picks one from a plain list, so it asks the largest page the server allows in one read (CLAUDE.md HARD RULE 9: a
// caller that needs the whole set asks for a large first page); `totalItems` tells the form when there are more.
//
// The server names each line's supplier and store by id; the recipient is PREFILLED from the supplier's record (the
// accepted design: name, contact, address — as far as the supplier's data goes), so the names are resolved in the SAME
// query function — SupplierByIds and SupplierChannelByIds, once each for the page — and a restock is never offered
// before the supplier it would prefill has arrived.
export const RESHIP_OPTIONS_PAGE = 200;

export function useReshipOptions(args: { teamId: bigint | undefined; enabled: boolean }) {
  const { teamId, enabled } = args;

  return useQuery({
    queryKey: key.customShipments(teamId, { reshipOptions: true }),
    enabled: enabled && teamId !== undefined,
    queryFn: async (): Promise<{ options: ReshipOption[]; totalItems: number }> => {
      const res = await customShipmentClient.customShipmentReshipOptions({
        teamId: teamId!,
        q: "",
        page: { page: 1, limit: RESHIP_OPTIONS_PAGE },
      });

      const options = res.options.map(reshipOptionFromWire);
      const lines = options.flatMap((o) => o.lines);
      const supplierIds = [...new Set(lines.map((l) => l.supplierId).filter((id) => id > 0n))];
      const channelIds = [...new Set(lines.map((l) => l.supplierChannelId).filter((id) => id > 0n))];

      const [suppliers, channels] = await Promise.all([
        supplierIds.length > 0
          ? supplierClient
              .supplierByIds({ teamId: teamId!, filter: { ids: supplierIds }, dataRequest: supplierByIdsRowData() })
              .then(suppliersFromByIds)
          : Promise.resolve(new Map<string, never>()),
        channelIds.length > 0
          ? supplierChannelClient.supplierChannelByIds({ teamId: teamId!, ids: channelIds }).then((r) => r.channels)
          : Promise.resolve({} as Record<string, { name: string }>),
      ]);

      for (const line of lines) {
        const supplier = line.supplierId > 0n ? suppliers.get(line.supplierId.toString()) : undefined;
        if (supplier) line.supplier = { id: supplier.id, name: supplier.name, contact: supplier.contact, address: supplier.address };
        line.storeName = line.supplierChannelId > 0n ? (channels[line.supplierChannelId.toString()]?.name ?? "") : "";
      }

      return { options, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

export function useInvalidateCustomShipments() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["customShipments"] });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────
//
// Two of them MOVE STOCK and refresh the stock screens too (useInvalidateStock): a sample's CREATE takes its units, and
// its CANCEL puts them back on the racks they left. The others change only the parcel. A refused write re-reads as well,
// so the screen behind it shows the parcel as it is now.

function useInvalidateShipmentsAndStock() {
  const invalidate = useInvalidateCustomShipments();
  const invalidateStock = useInvalidateStock();

  return async () => {
    await Promise.all([invalidate(), invalidateStock()]);
  };
}

export function useCreateCustomShipment() {
  const invalidate = useInvalidateShipmentsAndStock();

  return useMutation({
    mutationFn: async (vars: Parameters<typeof customShipmentClient.customShipmentCreate>[0]) => {
      const res = await customShipmentClient.customShipmentCreate(vars);

      return res.customShipment ? customShipmentFromWire(res.customShipment) : null;
    },
    onSuccess: () => invalidate(),
  });
}

export function useCancelCustomShipment() {
  const invalidate = useInvalidateShipmentsAndStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentCancel>[0]) =>
      customShipmentClient.customShipmentCancel(vars),
    onSettled: () => invalidate(),
  });
}

export function useSetCustomShipmentCost() {
  const invalidate = useInvalidateCustomShipments();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentCostSet>[0]) =>
      customShipmentClient.customShipmentCostSet(vars),
    onSettled: () => invalidate(),
  });
}

export function useMarkCustomShipmentPicked() {
  const invalidate = useInvalidateCustomShipments();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentPicked>[0]) =>
      customShipmentClient.customShipmentPicked(vars),
    onSettled: () => invalidate(),
  });
}

// *BARANG TIDAK KETEMU* (backlog #88 P6) — the shipping warehouse's goods-missing note. It writes one trail row and
// moves nothing (no status, no stock, nothing posts), so only the parcels are re-read — the list's badge, the page's
// notice and its trail — never the stock screens.
export function useReportGoodsMissing() {
  const invalidate = useInvalidateCustomShipments();

  return useMutation({
    mutationFn: async (vars: Parameters<typeof customShipmentClient.customShipmentMissingReport>[0]) => {
      const res = await customShipmentClient.customShipmentMissingReport(vars);

      return res.customShipment ? customShipmentFromWire(res.customShipment) : null;
    },
    onSettled: () => invalidate(),
  });
}

export function useHandOverCustomShipment() {
  const invalidate = useInvalidateCustomShipments();

  return useMutation({
    mutationFn: (vars: Parameters<typeof customShipmentClient.customShipmentHandover>[0]) =>
      customShipmentClient.customShipmentHandover(vars),
    onSettled: () => invalidate(),
  });
}
