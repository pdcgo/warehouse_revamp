import {
  type RestockRequest,
  RestockRequestListDataType,
  type RestockRequestListResponseItem,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";

// RestockRequestList moved to the guideline shape; the RESTOCK_REQUEST slice reuses the RestockRequest
// message directly (its preloaded items included), so this pulls RestockRequest[] out at the boundary.
export const restockListRowData = (): RestockRequestListDataType[] => [
  RestockRequestListDataType.RESTOCK_REQUEST,
];

export function restocksFromList(
  items: RestockRequestListResponseItem[],
  ids: bigint[],
): RestockRequest[] {
  let m: { [key: string]: RestockRequest } = {};
  for (const it of items) {
    if (it.d.case === "restockRequest") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((r): r is RestockRequest => !!r);
}
