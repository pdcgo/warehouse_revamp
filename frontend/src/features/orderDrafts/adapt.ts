import {
  type OrderDraft,
  OrderDraftListDataType,
  type OrderDraftListResponseItem,
} from "../../gen/warehouse/selling/v1/order_draft_pb";

// OrderDraftList moved to the guideline list shape; the ORDER_DRAFT slice reuses the OrderDraft
// message directly (item_count / unmapped_item_count included), so this pulls OrderDraft[] out.
export const orderDraftListRowData = (): OrderDraftListDataType[] => [
  OrderDraftListDataType.ORDER_DRAFT,
];

export function draftsFromList(items: OrderDraftListResponseItem[], ids: bigint[]): OrderDraft[] {
  let rowMap: { [key: string]: OrderDraft } = {};
  for (const it of items) {
    if (it.d.case === "orderDraft") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: OrderDraft[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}
