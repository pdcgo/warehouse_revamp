// THE COURIER'S TRACKING LINK (an-orders-resi-links-to-the-couriers-tracking-page, the-tracking-link-prototype-is-accepted,
// a-tracking-link-must-carry-the-resi; docs/business/shipment/context_decision.md).
//
// NOW, an order's resi links to its courier's OWN tracking page: the app reads no tracking itself (an aggregator comes
// later, as its own slice). Root keeps one link per channel (a-channel-is-a-courier, only-root-manages-channels) on the
// channels screen: an `https://` address with `{resi}` where the number goes, optional. A channel with no link → the
// order shows no link, and its resi stays copyable as today.
//
// On the wire: `ShipmentChannel.tracking_url` ("" = none), read by List and ByIds; written by ShipmentChannelCreate /
// ShipmentChannelUpdate (root only), which refuse a link under the SAME rule as `trackingLinkProblem` below, each for
// its own reason (shipment_service `tracking_url.go`). The screens draw it through CourierTrackingLink.tsx.
//
// These two helpers are PURE so the unit run pins them in Node (trackingLink.test.ts).

/** Where the resi goes in root's link. */
export const RESI_PLACEHOLDER = "{resi}";

/**
 * The courier's page for THIS parcel: root's link with every `{resi}` replaced by the resi, URL-ENCODED (a resi is
 * typed by people and read off labels — a space, `/`, `#` or `&` must never change where the link goes). `null` when
 * there is nothing to open: no link on the channel, a link without `{resi}`, or no resi on the order.
 */
export function trackingHref(template: string | undefined, resi: string | undefined): string | null {
  const link = (template ?? "").trim();
  const code = (resi ?? "").trim();

  if (link === "" || code === "" || !link.includes(RESI_PLACEHOLDER)) return null;

  return link.split(RESI_PLACEHOLDER).join(encodeURIComponent(code));
}

/** Why the channels screen refuses a link — each has its sentence (`shipmentChannels.trackingUrlNotHttps` / `NoResi` / `NotAUrl`). */
export type TrackingLinkProblem = "notHttps" | "noResi" | "notAUrl";

/**
 * Root's link, checked as the channel form saves it. `null` = fine — "" included, since the link is OPTIONAL (a courier
 * with no page of its own simply has none). Refused: anything but `https://` (the link opens from a signed-in page), a
 * link with no `{resi}` (it would open the courier's page without the parcel), and text that is no address at all.
 */
export function trackingLinkProblem(url: string): TrackingLinkProblem | null {
  const link = url.trim();

  if (link === "") return null;
  if (!link.toLowerCase().startsWith("https://")) return "notHttps";
  if (!link.includes(RESI_PLACEHOLDER)) return "noResi";

  try {
    const parsed = new URL(link.split(RESI_PLACEHOLDER).join("RESI"));
    if (parsed.protocol !== "https:" || parsed.hostname === "" || /\s/.test(link)) return "notAUrl";
  } catch {
    return "notAUrl";
  }

  return null;
}
