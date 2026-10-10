import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// The status tabs both transfer lists show, so the selling side and the warehouse side cannot filter one lifecycle by
// different names. UNSPECIFIED is the absence of a filter — "All Status". The labels are the
// `warehouseTransfer.status.*` keys the badge renders, so a tab and the badges under it never disagree. The order is
// the transfer's journey (a-transfer-has-seven-statuses), then the two ends it never reached.
export interface TransferStatusTab {
  value: string;
  labelKey: string;
  status: WarehouseTransferStatus;
}

export const TRANSFER_STATUS_TABS: TransferStatusTab[] = [
  { value: "all", labelKey: "warehouseTransfer.tab.allStatus", status: WarehouseTransferStatus.UNSPECIFIED },
  { value: "created", labelKey: "warehouseTransfer.status.created", status: WarehouseTransferStatus.CREATED },
  { value: "process", labelKey: "warehouseTransfer.status.process", status: WarehouseTransferStatus.PROCESS },
  { value: "shipped", labelKey: "warehouseTransfer.status.shipped", status: WarehouseTransferStatus.SHIPPED },
  { value: "arrived", labelKey: "warehouseTransfer.status.arrived", status: WarehouseTransferStatus.ARRIVED },
  { value: "accepted", labelKey: "warehouseTransfer.status.accepted", status: WarehouseTransferStatus.ACCEPTED },
  { value: "lost", labelKey: "warehouseTransfer.status.lost", status: WarehouseTransferStatus.LOST },
  { value: "cancelled", labelKey: "warehouseTransfer.status.cancelled", status: WarehouseTransferStatus.CANCELLED },
];

export function transferTab(value: string): TransferStatusTab {
  return TRANSFER_STATUS_TABS.find((item) => item.value === value) ?? TRANSFER_STATUS_TABS[0];
}
