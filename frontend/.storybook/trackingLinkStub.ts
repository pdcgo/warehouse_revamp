// THE COURIERS' TRACKING LINKS IN A STORY (an-orders-resi-links-to-the-couriers-tracking-page,
// the-tracking-link-prototype-is-accepted; the rule: src/features/shipment/trackingLink.ts).
//
// The fixture channels (fixtures.ts `shipmentChannels`) carry NO link, so every story reads the screens as a database
// whose couriers have none — what 00003 leaves (no backfill). A story that wants links calls `trackingLinksForStory()`
// in its `beforeEach`: the stub transport then serves each channel's `tracking_url` from here until a Create / Update
// writes its own (stubTransport.ts, the ShipmentChannelService). Reset per story by `resetShipmentChannels()`.
//
// ⚠ SAMPLE ADDRESSES, for the stories only — root types each courier's real tracking page. They were NOT checked
// against the couriers' sites; nothing seeds them anywhere real.

export const channelTrackingUrls: { channelId: bigint; code: string; trackingUrl: string }[] = [
  { channelId: 91n, code: "jne", trackingUrl: "https://www.jne.co.id/en/tracking/trace?awb={resi}" },
  { channelId: 92n, code: "jnt", trackingUrl: "https://jet.co.id/track?awb={resi}" },
  // NO LINK: SiCepat's orders show their resi copyable, as before, and no ↗ (order 102, 106).
  { channelId: 93n, code: "sicepat", trackingUrl: "" },
  // Deleted — its old orders still open it (a-deleted-channel-still-resolves-by-id).
  { channelId: 94n, code: "pos", trackingUrl: "https://www.posindonesia.co.id/id/tracking?barcode={resi}" },
];

/** What the stub serves and what Create / Update sent — reset per story. */
export const trackingLinkScenario = {
  /** The links the couriers start the story with, by channel id; a channel absent here has none. */
  links: {} as Record<string, string>,
  /** Every `tracking_url` a Create or Update SENT (what root saved), in order. */
  saved: [] as { channelId: bigint; trackingUrl: string }[],
};

/** Gives the fixture couriers the links above for this story — JNE, J&T and the deleted POS; SiCepat none. */
export function trackingLinksForStory(links?: Record<string, string>) {
  trackingLinkScenario.links =
    links ??
    Object.fromEntries(
      channelTrackingUrls.filter((c) => c.trackingUrl !== "").map((c) => [c.channelId.toString(), c.trackingUrl]),
    );
}

/** The link a channel starts the story with ("" = none) — read by the stub for a row no write has touched. */
export function storyLinkOf(channelId: bigint): string {
  return trackingLinkScenario.links[channelId.toString()] ?? "";
}

export function recordTrackingLinkSave(channelId: bigint, trackingUrl: string) {
  trackingLinkScenario.saved.push({ channelId, trackingUrl });
}

export function resetTrackingLinkScenario() {
  trackingLinkScenario.links = {};
  trackingLinkScenario.saved = [];
}
