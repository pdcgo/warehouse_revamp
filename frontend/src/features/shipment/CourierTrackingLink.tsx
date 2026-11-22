import type { MouseEvent } from "react";
import { Icon, Link, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";

import { useShippingCatalogue } from "../shipping/catalogue";
import { trackingHref } from "./trackingLink";

// THE COURIER'S TRACKING LINK, ON THE SCREENS (an-orders-resi-links-to-the-couriers-tracking-page,
// the-tracking-link-prototype-is-accepted). The rule and the href: trackingLink.ts.
//
// Where the link comes from: root keeps one per courier (`ShipmentChannel.tracking_url`, the channels screen). A screen
// reads it from the SHARED COURIER CATALOGUE (features/shipping/catalogue.ts) — the one `ShipmentChannelList` per session
// that already names every order's courier (OrderCourierBadge), deleted couriers included. So a list row costs no
// request of its own, and a deleted courier's link still opens for its old orders (a-deleted-channel-still-resolves-by-id).

/**
 * The courier's page for this order's resi — null for no courier, a courier with no link, an order with no resi, and
 * while the catalogue loads (the resi is drawn copyable either way; the ↗ follows once the catalogue is in).
 */
export function useTrackingHref(channelId: bigint | undefined, resi: string | undefined): string | null {
  const { couriers } = useShippingCatalogue();

  if (channelId === undefined || channelId === 0n) return null;

  return trackingHref(couriers.find((c) => c.id === channelId)?.trackingUrl, resi);
}

/**
 * The ↗ beside a resi — opens the courier's tracking page in a NEW TAB (`noopener noreferrer`: the courier's page gets
 * no handle on ours and no referrer naming the order). Beside the copy action, never instead of it: the resi is still
 * what a buyer is sent on WhatsApp. `hint` shows the words *Lacak di situs kurir* next to the icon (the detail pages);
 * without it the icon alone, its words as the label and the tooltip (a list cell, where a second phrase would not fit).
 *
 * ⚠ IT STOPS THE ROW'S NAVIGATE, as CopyText does: a list row opens the order on click.
 */
export function TrackingLink({ href, hint = false, testId }: { href: string; hint?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const label = t("orders.trackOnCourierSite");

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      colorPalette="brand"
      fontSize="xs"
      fontWeight="normal"
      gap="1"
      whiteSpace="nowrap"
      aria-label={hint ? undefined : label}
      title={label}
      data-testid={testId}
      onClick={(event: MouseEvent) => event.stopPropagation()}
    >
      <Icon as={ExternalLink} boxSize="3.5" flexShrink={0} />
      {hint && <Text as="span">{label}</Text>}
    </Link>
  );
}
