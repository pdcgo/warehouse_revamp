import { Badge, HStack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { courierColor } from "./ShippingBadge";

// ShipmentChannelBadge shows an order's courier from its shipment_channel_id.
//
// PRESENTATIONAL: the caller resolves ids once for the whole screen (useShipmentChannelsByIds) and
// hands each row its channel — a badge per row fetching for itself would be one request per row.
//
// Three cases, each a decision (docs/business/shipment/context_decision.md):
//  - no id           → "—". A draft may not have a channel yet.
//  - a DELETED one   → its name, muted, marked deleted — never blank
//                      (a-deleted-channel-still-resolves-by-id).
//  - an unknown id   → "#id", gray. Never a borrowed name.
//
// ⚠ PROTOTYPE — replaces ShippingBadge (keyed by code) once the shipment design is accepted. The colour
// map is ShippingBadge's, keyed by the same stable code, so a courier keeps its colour across the move.
export const description =
  "An order's courier from its shipment_channel_id — standard colour by code, a deleted channel still named and marked, an unknown id shown as #id, no id as “—”.";

export interface ShipmentChannelBadgeProps {
  channelId: bigint;
  /** The resolved channel, or undefined when the id resolved to nothing (or is still loading). */
  channel?: ShipmentChannel;
}

export function ShipmentChannelBadge({ channelId, channel }: ShipmentChannelBadgeProps) {
  const { t } = useTranslation();

  if (channelId === 0n) {
    return (
      <Text as="span" color="fg.muted" data-testid="shipment-channel-badge-none">
        —
      </Text>
    );
  }

  if (!channel) {
    return (
      <Badge colorPalette="gray" variant="outline" data-testid={`shipment-channel-badge-unknown-${channelId}`}>
        #{channelId.toString()}
      </Badge>
    );
  }

  if (channel.isDeleted) {
    return (
      <HStack gap="1" display="inline-flex" data-testid={`shipment-channel-badge-${channel.code}`}>
        <Badge colorPalette="gray" variant="subtle" textDecoration="line-through">
          {channel.name}
        </Badge>
        <Text as="span" fontSize="xs" color="fg.muted" data-testid={`shipment-channel-badge-deleted-${channel.code}`}>
          {t("shipmentChannels.deleted")}
        </Text>
      </HStack>
    );
  }

  return (
    <Badge colorPalette={courierColor(channel.code)} data-testid={`shipment-channel-badge-${channel.code}`}>
      {channel.name}
    </Badge>
  );
}
