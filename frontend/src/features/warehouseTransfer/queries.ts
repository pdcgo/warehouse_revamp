import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { warehouseTransferClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { useInvalidateStock } from "../inventory/queries";
import { fetchActors, useActors } from "../users/queries";
import type {
  WarehouseTransferDirection,
  WarehouseTransferStatus,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { transferListRowData, transfersFromList } from "./adapt";

// The warehouse transfer screens' reads and writes (docs/business/inventory/warehouse_transfer.md).

export interface TransferListArgs {
  teamId: bigint | undefined;
  status: WarehouseTransferStatus;
  /** A warehouse's lens: leaving it, or coming to it. UNSPECIFIED on the selling side. */
  direction?: WarehouseTransferDirection;
  /** 0 = any. Selling side: either end. Warehouse side: the other end. */
  warehouseId?: bigint;
  /** 0 = every team. Warehouse side only — whose goods. */
  ownerTeamId?: bigint;
  /** Free text over number / tracking number / SKU / product name. */
  q?: string;
  page: number;
  pageSize: number;
}

export function useWarehouseTransfers(args: TransferListArgs) {
  const { teamId, status, direction = 0, warehouseId = 0n, ownerTeamId = 0n, q = "", page, pageSize } = args;

  return useQuery({
    // EVERY filter is server-side, so every one is in the key — each combination is a different question with its own
    // totalItems.
    queryKey: key.warehouseTransfer(teamId, {
      status,
      direction,
      warehouseId: warehouseId.toString(),
      ownerTeamId: ownerTeamId.toString(),
      q,
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await warehouseTransferClient.warehouseTransferList({
        teamId: teamId!,
        filter: { status, direction, warehouseId, ownerTeamId, q },
        dataRequest: transferListRowData(),
        page: { page, limit: pageSize },
      });

      const transfers = transfersFromList(res.items, res.ids);
      // Who opened each row, resolved once for the page rather than by each row.
      const actors = await fetchActors(transfers.map((r) => r.createdByUserId));

      return { transfers, actors, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

export function useWarehouseTransfer(args: { teamId: bigint | undefined; transferId: bigint }) {
  const { teamId, transferId } = args;

  return useQuery({
    queryKey: key.warehouseTransfer(teamId, { transferId: transferId.toString() }),
    enabled: teamId !== undefined && transferId > 0n,
    queryFn: async () => {
      const res = await warehouseTransferClient.warehouseTransferDetail({ teamId: teamId!, transferId });

      return res.transfer ?? null;
    },
  });
}

/** The people behind a transfer's trail, by id — the shared user lookup. */
export function useTransferActors(userIds: bigint[]) {
  return useActors(userIds);
}

export function useInvalidateTransfer() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["warehouseTransfer"] });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────
//
// Three of them MOVE STOCK, and those refresh the stock screens too (useInvalidateStock fans out to inventory, restock
// and racks): CREATE takes the units from A's book (a-transfer-takes-from-the-sender-at-create), CANCEL puts them back,
// and ACCEPT adds them to B's. The rest change only the transfer.

function useInvalidateTransferAndStock() {
  const invalidate = useInvalidateTransfer();
  const invalidateStock = useInvalidateStock();

  return async () => {
    await Promise.all([invalidate(), invalidateStock()]);
  };
}

export function useCreateWarehouseTransfer() {
  const invalidate = useInvalidateTransferAndStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferCreate>[0]) =>
      warehouseTransferClient.warehouseTransferCreate(vars),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateWarehouseTransfer() {
  const invalidate = useInvalidateTransfer();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferUpdate>[0]) =>
      warehouseTransferClient.warehouseTransferUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

export function useCancelWarehouseTransfer() {
  const invalidate = useInvalidateTransferAndStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferCancel>[0]) =>
      warehouseTransferClient.warehouseTransferCancel(vars),
    onSuccess: () => invalidate(),
  });
}

export function useMarkLostWarehouseTransfer() {
  const invalidate = useInvalidateTransfer();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferMarkLost>[0]) =>
      warehouseTransferClient.warehouseTransferMarkLost(vars),
    onSuccess: () => invalidate(),
  });
}

export function useProcessWarehouseTransfer() {
  const invalidate = useInvalidateTransfer();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferProcess>[0]) =>
      warehouseTransferClient.warehouseTransferProcess(vars),
    onSuccess: () => invalidate(),
  });
}

export function useShipWarehouseTransfer() {
  const invalidate = useInvalidateTransfer();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferShip>[0]) =>
      warehouseTransferClient.warehouseTransferShip(vars),
    onSuccess: () => invalidate(),
  });
}

export function useArriveWarehouseTransfer() {
  const invalidate = useInvalidateTransfer();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferArrive>[0]) =>
      warehouseTransferClient.warehouseTransferArrive(vars),
    onSuccess: () => invalidate(),
  });
}

export function useAcceptWarehouseTransfer() {
  const invalidate = useInvalidateTransferAndStock();

  return useMutation({
    mutationFn: (vars: Parameters<typeof warehouseTransferClient.warehouseTransferAccept>[0]) =>
      warehouseTransferClient.warehouseTransferAccept(vars),
    onSuccess: () => invalidate(),
  });
}
