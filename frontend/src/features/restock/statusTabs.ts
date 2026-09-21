import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// The status tabs both restock lists show (#130), shared so the selling side and the warehouse side
// cannot end up filtering the same lifecycle by different names.
//
// UNSPECIFIED is not a status a request can hold — it is the ABSENCE of a filter, which is exactly
// what "All Status" means to the RPC. That is why this can be a plain list instead of a special case.
//
// The labels are the `restock.status.*` keys RestockStatusBadge already renders, so a tab and the
// badges under it can never disagree. Only "All Status" needed a key of its own.
export interface RestockStatusTab {
  value: string;
  labelKey: string;
  status: RestockRequestStatus;
}

export const RESTOCK_STATUS_TABS: RestockStatusTab[] = [
  { value: "all", labelKey: "restock.tab.allStatus", status: RestockRequestStatus.UNSPECIFIED },
  { value: "pending", labelKey: "restock.status.pending", status: RestockRequestStatus.PENDING },
  {
    value: "fulfilled",
    labelKey: "restock.status.fulfilled",
    status: RestockRequestStatus.FULFILLED,
  },
  {
    value: "cancelled",
    labelKey: "restock.status.cancelled",
    status: RestockRequestStatus.CANCELLED,
  },
];

export function restockTab(value: string): RestockStatusTab {
  return RESTOCK_STATUS_TABS.find((item) => item.value === value) ?? RESTOCK_STATUS_TABS[0];
}
