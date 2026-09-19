import {
  type ShipmentChannel,
  ShipmentChannelByIdsDataType,
  type ShipmentChannelByIdsResponse,
  ShipmentChannelListDataType,
  type ShipmentChannelListResponseItem,
} from "../../gen/warehouse/shipment/v1/shipment_pb";

// ShipmentChannelList / ShipmentChannelByIds answer in the guideline's columnar shape; these pull the
// CHANNEL slice out at the query boundary so no screen reads the envelope.

export const channelListRowData = (): ShipmentChannelListDataType[] => [ShipmentChannelListDataType.CHANNEL];
export const channelByIdsRowData = (): ShipmentChannelByIdsDataType[] => [ShipmentChannelByIdsDataType.CHANNEL];

export function channelsFromList(items: ShipmentChannelListResponseItem[], ids: bigint[]): ShipmentChannel[] {
  let m: { [key: string]: ShipmentChannel } = {};
  for (const it of items) {
    if (it.d.case === "channel") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((c): c is ShipmentChannel => !!c);
}

// Keyed per id. A DELETED channel is present, with isDeleted set — that is the contract
// (a-deleted-channel-still-resolves-by-id). An id that never existed is absent, and the caller decides
// what "unknown" looks like.
export function channelsFromByIds(res: ShipmentChannelByIdsResponse): Map<string, ShipmentChannel> {
  const out = new Map<string, ShipmentChannel>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const item of list.items) {
      if (item.d.case !== "channel") continue;

      const channel = item.d.value.mapData[id];
      if (channel) out.set(id, channel);
    }
  }

  return out;
}
