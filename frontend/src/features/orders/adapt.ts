import {
  type Order,
  OrderListDataType,
  type OrderListResponseItem,
} from "../../gen/warehouse/selling/v1/order_pb";

// OrderList moved to the guideline list shape; the ORDER slice reuses the Order message directly, so
// this pulls Order[] out of the items/ids envelope at the query boundary.
export const orderListRowData = (): OrderListDataType[] => [OrderListDataType.ORDER];

export function ordersFromList(items: OrderListResponseItem[], ids: bigint[]): Order[] {
  let rowMap: { [key: string]: Order } = {};
  for (const it of items) {
    if (it.d.case === "order") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: Order[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}
