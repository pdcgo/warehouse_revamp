import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// The status tabs the order list shows — one per status, in LIFECYCLE ORDER rather than enum order,
// because that is the order the work happens in: an order is placed, confirmed, picked, packed,
// shipped, and cancelled is the tail that leaves the line.
//
// UNSPECIFIED is not a status an order can hold — it is the ABSENCE of a filter, which is exactly what
// "All Status" means to OrderList. That is why this can be a plain list instead of a special case.
//
// The labels are the `orders.statusName.*` keys OrderStatusBadge renders, so a tab and the badges
// under it can never disagree about what a status is called. Only "All Status" needed a key of its own.
export interface OrderStatusTab {
  value: string;
  labelKey: string;
  status: OrderStatus;
}

export const ORDER_STATUS_TABS: OrderStatusTab[] = [
  { value: "all", labelKey: "orders.tab.allStatus", status: OrderStatus.UNSPECIFIED },
  { value: "placed", labelKey: "orders.statusName.placed", status: OrderStatus.PLACED },
  { value: "confirmed", labelKey: "orders.statusName.confirmed", status: OrderStatus.CONFIRMED },
  { value: "picking", labelKey: "orders.statusName.picking", status: OrderStatus.PICKING },
  { value: "packed", labelKey: "orders.statusName.packed", status: OrderStatus.PACKED },
  { value: "shipped", labelKey: "orders.statusName.shipped", status: OrderStatus.SHIPPED },
  { value: "cancelled", labelKey: "orders.statusName.cancelled", status: OrderStatus.CANCELLED },
];

export function orderTab(value: string): OrderStatusTab {
  return ORDER_STATUS_TABS.find((item) => item.value === value) ?? ORDER_STATUS_TABS[0];
}
