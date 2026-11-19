import { useTranslation } from "react-i18next";
import { Flex, Spacer, Text } from "@chakra-ui/react";

import { OrderCourierBadge } from "../../../features/orders/OrderCourierBadge";

// THE PARCELS IN THE HANDOVER, COUNTED PER COURIER — Per kurir (the-print-page-and-the-courier-count-prototype-is-accepted;
// acceptance inventory/order.md:207, *parcel count per courier shown*) — what the crew reads out to each courier's driver: JNE 12, SiCepat 4.
//
// A COUNT ON SCREEN, NOT A MANIFEST (scanning-is-the-crews-hands: *"no manifest"*): nothing is printed or stored, and
// recording the handover stays deferred (the-handover-is-shipments-and-deferred). The counts are the dialog's own good
// parcels — ready to hand over, or handed over — grouped by the order's `shipment_channel_id`, named from the shared
// courier catalogue as every courier badge is. A wrong-step, unknown or several-orders scan is no parcel for a courier
// and is not counted.
//
// Most first; a tie in the catalogue's id order, so the strip does not reshuffle as equal counts trade places.

export function CourierCounts({ parcels }: { parcels: readonly { id: bigint; shipmentChannelId: bigint }[] }) {
  const { t } = useTranslation();

  if (parcels.length === 0) return null;

  const counts = new Map<string, { channelId: bigint; count: number }>();
  for (const parcel of parcels) {
    const k = parcel.shipmentChannelId.toString();
    const row = counts.get(k) ?? { channelId: parcel.shipmentChannelId, count: 0 };
    row.count += 1;
    counts.set(k, row);
  }
  const rows = [...counts.values()].sort(
    (a, b) => b.count - a.count || (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0),
  );

  return (
    <Flex
      align="center"
      gap="3"
      rowGap="2"
      wrap="wrap"
      px="3"
      py="2"
      borderWidth="1px"
      borderColor="border"
      borderRadius="l2"
      data-testid="handover-courier-counts"
    >
      <Text fontSize="sm" fontWeight="bold">
        {t("warehouseOrders.handover.perCourier")}
      </Text>
      {rows.map((row) => (
        <Flex
          key={row.channelId.toString()}
          align="center"
          gap="1.5"
          data-testid={`handover-courier-count-${row.channelId}`}
          data-count={row.count}
        >
          <OrderCourierBadge channelId={row.channelId} />
          <Text fontSize="sm" fontWeight="bold">
            {row.count}
          </Text>
        </Flex>
      ))}
      <Spacer />
      <Text fontSize="xs" color="fg.muted" data-testid="handover-courier-total">
        {t("warehouseOrders.handover.parcels", { count: parcels.length })}
      </Text>
    </Flex>
  );
}
