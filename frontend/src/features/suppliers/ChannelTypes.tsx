import { HStack, Text } from "@chakra-ui/react";

import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

export const description =
  "A supplier's live stores as badges, one per channel TYPE — three Shopee stores read \"Shopee ×3\", the count inside the badge, never three identical badges. A supplier with none reads —.";

// A supplier's stores as badges — one per channel TYPE, so a supplier with three Shopee stores reads "Shopee ×3"
// rather than three identical badges. Shared by the two supplier lists, the team's own and Discover's: a supplier's
// stores read the same on both.
export function ChannelTypes({ channels }: { channels: { channelType: Marketplace }[] }) {
  const counts = new Map<Marketplace, number>();
  for (const c of channels) {
    counts.set(c.channelType, (counts.get(c.channelType) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return <Text color="fg.muted">—</Text>;
  }

  return (
    <HStack gap="1" wrap="wrap">
      {/* The count INSIDE the badge (owner, `a-store-count-sits-in-its-badge`) — one chip per type, evenly spaced. */}
      {[...counts].map(([type, n]) => (
        <MarketplaceBadge key={type} marketplace={type} count={n} />
      ))}
    </HStack>
  );
}
