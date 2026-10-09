import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// The status tabs both restock lists show, shared so the selling side and the warehouse side cannot end up filtering
// the same lifecycle by different names.
//
// UNSPECIFIED is the ABSENCE of a filter, which is exactly what "All Status" means to the RPC. The labels are the
// `restock.status.*` keys RestockStatusBadge renders, so a tab and the badges under it can never disagree. The order is
// the restock's journey: on its way, at the door, counted in — then the two ends that are not
// (the-warehouse-signs-and-accepts-the-team-does-the-rest).
export interface RestockStatusTab {
  value: string;
  labelKey: string;
  status: RestockRequestStatus;
}

export const RESTOCK_STATUS_TABS: RestockStatusTab[] = [
  { value: "all", labelKey: "restock.tab.allStatus", status: RestockRequestStatus.UNSPECIFIED },
  { value: "ongoing", labelKey: "restock.status.ongoing", status: RestockRequestStatus.ONGOING },
  { value: "arrived", labelKey: "restock.status.arrived", status: RestockRequestStatus.ARRIVED },
  { value: "accepted", labelKey: "restock.status.accepted", status: RestockRequestStatus.ACCEPTED },
  { value: "lost", labelKey: "restock.status.lost", status: RestockRequestStatus.LOST },
  { value: "cancelled", labelKey: "restock.status.cancelled", status: RestockRequestStatus.CANCELLED },
];

export function restockTab(value: string): RestockStatusTab {
  return RESTOCK_STATUS_TABS.find((item) => item.value === value) ?? RESTOCK_STATUS_TABS[0];
}
