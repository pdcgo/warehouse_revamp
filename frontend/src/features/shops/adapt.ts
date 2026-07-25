import {
  type Shop,
  ShopListDataType,
  type ShopListResponseItem,
} from "../../gen/warehouse/selling/v1/selling_pb";

// ShopList moved to the guideline list shape; the SHOP slice reuses the Shop message directly, so
// this pulls Shop[] out of the items/ids envelope at the query boundary.
export const shopListRowData = (): ShopListDataType[] => [ShopListDataType.SHOP];

export function shopsFromList(items: ShopListResponseItem[], ids: bigint[]): Shop[] {
  let rowMap: { [key: string]: Shop } = {};
  for (const it of items) {
    if (it.d.case === "shop") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: Shop[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}
