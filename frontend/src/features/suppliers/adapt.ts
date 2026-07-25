import {
  type Supplier,
  SupplierListDataType,
  type SupplierListResponseItem,
} from "../../gen/warehouse/inventory/v1/supplier_pb";
import {
  type SupplierChannel,
  SupplierChannelListDataType,
  type SupplierChannelListResponseItem,
} from "../../gen/warehouse/inventory/v1/supplier_channel_pb";

// SupplierList / SupplierChannelList moved to the guideline shape; the SUPPLIER / SUPPLIER_CHANNEL
// slices reuse the entity messages directly, so these pull them out at the query boundary.

export const supplierListRowData = (): SupplierListDataType[] => [SupplierListDataType.SUPPLIER];
export const supplierChannelRowData = (): SupplierChannelListDataType[] => [
  SupplierChannelListDataType.SUPPLIER_CHANNEL,
];

export function suppliersFromList(items: SupplierListResponseItem[], ids: bigint[]): Supplier[] {
  let m: { [key: string]: Supplier } = {};
  for (const it of items) {
    if (it.d.case === "supplier") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((s): s is Supplier => !!s);
}

export function channelsFromList(
  items: SupplierChannelListResponseItem[],
  ids: bigint[],
): SupplierChannel[] {
  let m: { [key: string]: SupplierChannel } = {};
  for (const it of items) {
    if (it.d.case === "supplierChannel") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((c): c is SupplierChannel => !!c);
}
