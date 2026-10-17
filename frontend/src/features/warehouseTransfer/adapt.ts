import {
  type WarehouseTransfer,
  WarehouseTransferListDataType,
  type WarehouseTransferListResponseItem,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// WarehouseTransferList speaks the guideline's list shape; the WAREHOUSE_TRANSFER slice reuses the WarehouseTransfer
// message directly (its lines included), so this pulls WarehouseTransfer[] out at the boundary, in `ids` order.
export const transferListRowData = (): WarehouseTransferListDataType[] => [
  WarehouseTransferListDataType.WAREHOUSE_TRANSFER,
];

export function transfersFromList(items: WarehouseTransferListResponseItem[], ids: bigint[]): WarehouseTransfer[] {
  let m: { [key: string]: WarehouseTransfer } = {};
  for (const it of items) {
    if (it.d.case === "warehouseTransfer") m = it.d.value.mapData;
  }

  return ids.map((id) => m[id.toString()]).filter((r): r is WarehouseTransfer => !!r);
}
