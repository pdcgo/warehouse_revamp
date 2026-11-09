import { Skeleton } from "@chakra-ui/react";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { useShippingCatalogue } from "../shipping/catalogue";

// OrderCourierBadge is an ORDER's courier, from its `shipment_channel_id` (shipment-channel-is-an-id-into-shipment-service).
//
// The order stores the id and nothing else (the-channel-name-is-not-frozen), so the name is read here, from the
// shared courier catalogue — loaded ONCE per session with the deleted channels in it, so a row of a list costs no
// request of its own and an old order still names a deleted courier (a-deleted-channel-still-resolves-by-id). The
// drawing is ShipmentChannelBadge's: the courier's standard colour, a deleted one marked, an unknown id as `#id`, none
// as "—". While the catalogue loads, a badge-sized placeholder — never a `#id` that flips to a name a moment later.
export const description =
  "An order's courier from its shipment_channel_id, named from the shared courier catalogue (one request per session, deleted channels included) and drawn as ShipmentChannelBadge — a placeholder while the catalogue loads, “—” for none.";

export function OrderCourierBadge({ channelId }: { channelId: bigint }) {
  const { couriers, loading } = useShippingCatalogue();

  if (channelId > 0n && loading) {
    return <Skeleton display="inline-block" height="5" width="12" data-testid="order-courier-loading" />;
  }

  return <ShipmentChannelBadge channelId={channelId} channel={couriers.find((c) => c.id === channelId)} />;
}
