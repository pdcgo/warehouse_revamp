import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { ORDER_STAGES } from "./stages";

// The status tabs an order list shows — one per status, plus All, in the status diagram's order
// (one-tab-per-status), because that is the order the work happens in.
//
// UNSPECIFIED is not a status an order can hold — it is the ABSENCE of a filter, which is exactly what
// "All Status" means to OrderList. That is why this can be a plain list instead of a special case.
//
// The labels are the `orders.stage.*` keys OrderStatusBadge renders, so a tab and the badges under it
// can never disagree about what a status is called. Only "All Status" needed a key of its own.
export interface OrderStatusTab {
  value: string;
  labelKey: string;
  status: OrderStatus;
}

export const ORDER_STATUS_TABS: OrderStatusTab[] = [
  { value: "all", labelKey: "orders.tab.allStatus", status: OrderStatus.UNSPECIFIED },
  ...ORDER_STAGES.map((stage) => ({
    value: stage.id,
    labelKey: `orders.stage.${stage.id}`,
    status: stage.status,
  })),
];

export function orderTab(value: string): OrderStatusTab {
  return ORDER_STATUS_TABS.find((item) => item.value === value) ?? ORDER_STATUS_TABS[0];
}
