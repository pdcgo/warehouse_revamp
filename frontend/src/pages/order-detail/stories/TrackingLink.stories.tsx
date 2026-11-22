import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { orders } from "../../../../.storybook/fixtures";
import { DESKTOP, PHONE, TAG_VIEWPORTS } from "../../../../.storybook/restockTagKit";
import { channelTrackingUrls, trackingLinksForStory } from "../../../../.storybook/trackingLinkStub";
import { ORDER_DETAIL_META, Routed, SELLER, WAREHOUSE } from "./kit";

// ONE ORDER — ITS RESI LINKS TO THE COURIER'S TRACKING PAGE (the-tracking-link-prototype-is-accepted,
// an-orders-resi-links-to-the-couriers-tracking-page). NOW the order's resi opens its courier's own tracking page — the
// app reads no tracking itself (an aggregator comes later, its own slice). The link is the channel's, kept by root on
// the channels screen with a `{resi}` where the number goes (Pages/Shipment/ShipmentChannels/Tracking link); the resi is
// URL-encoded into it, and it opens in a new tab (`noopener noreferrer`). A courier with no link → no link, the resi
// copyable as before. The copy action always stays.
//
// Against the real stub: 101 ships by JNE (91), which has a link; 102 by SiCepat (93), which has none; POS (94) is
// deleted and keeps its link (.storybook/trackingLinkStub.ts, given per story by the meta's `beforeEach`).
//
//   seller's detail   the Info section's resi (the reference at the top) AND the Pengiriman section's resi
//   warehouse detail  the Info tab's RESI beside the courier, with the link

const At101 = Routed("/orders/101");
const At102 = Routed("/orders/102");

const JNE_LINK = channelTrackingUrls.find((c) => c.code === "jne")!.trackingUrl;
const POS_LINK = channelTrackingUrls.find((c) => c.code === "pos")!.trackingUrl;
const order101 = () => orders.find((o) => o.id === 101n)!;
const order102 = () => orders.find((o) => o.id === 102n)!;
/** What the courier's page opens on: root's link, the resi URL-encoded where `{resi}` is. */
const hrefFor = (link: string, resi: string) => link.replace("{resi}", encodeURIComponent(resi.trim()));

/** A `beforeEach` giving 101 another resi for one story; the fixture is put back after. */
const resiOf101 = (resi: string) => () => {
  const row = order101();
  const saved = row.receiptCode;
  row.receiptCode = resi;
  return () => {
    row.receiptCode = saved;
  };
};

/** A `beforeEach` shipping 101 by another courier for one story; the fixture is put back after. */
const courierOf101 = (channelId: bigint) => () => {
  const row = order101();
  const saved = row.shipmentChannelId;
  row.shipmentChannelId = channelId;
  return () => {
    row.shipmentChannelId = saved;
  };
};

const meta = {
  title: "Pages/Order/OrderDetailPage/Tracking link",
  ...ORDER_DETAIL_META,
  parameters: { ...ORDER_DETAIL_META.parameters, viewport: { options: TAG_VIEWPORTS } },
  beforeEach: [ORDER_DETAIL_META.beforeEach, () => trackingLinksForStory()],
  globals: DESKTOP,
  render: () => <At101 />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The link opens the courier's page for this resi, in a new tab that gets no handle on ours. */
async function expectTheLink(link: HTMLElement, resi: string, courierLink = JNE_LINK) {
  await expect(link).toHaveAttribute("href", hrefFor(courierLink, resi));
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
}

/**
 * The seller's page has read the courier catalogue (where the links come from) once the reference names the courier —
 * so a "no link" check after it is not passed by a page that simply has not read the links yet.
 */
async function sellerCatalogueRead(canvasElement: HTMLElement, courierCode: string) {
  const reference = await within(canvasElement).findByTestId("order-reference-receipt", {}, { timeout: 4000 });
  await waitFor(() => expect(reference).toHaveTextContent(courierCode.toUpperCase()), { timeout: 4000 });
  return reference;
}

/** The warehouse's Info tab has read the catalogue once its courier badge is drawn (no loading placeholder). */
async function warehouseCatalogueRead(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("order-detail-tabs", {}, { timeout: 4000 });
  await waitFor(() => expect(canvas.queryAllByTestId("order-courier-loading")).toHaveLength(0), { timeout: 4000 });
}

/**
 * THE SELLER'S DETAIL — both resis it shows link to JNE's page: the reference at the top of Info, and the Pengiriman
 * section's (beside *no tracking recorded*, the way to follow the parcel meanwhile). Each keeps its copy action, and the
 * link says *Track on the courier's site*.
 */
export const SellerSeesTheLink: Story = {
  name: "Seller — the resi links to the courier's page (Info and Pengiriman)",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resi = order101().receiptCode;

    const reference = await canvas.findByTestId("order-reference-receipt", {}, { timeout: 4000 });
    const top = await within(reference).findByTestId("order-reference-track", {}, { timeout: 4000 });
    await expectTheLink(top, resi);
    await expect(top).toHaveTextContent("Track on the courier's site");
    await expect(within(reference).getByRole("button", { name: new RegExp(resi) })).toBeVisible();

    const leg = canvas.getByTestId("shipment-outbound");
    const below = await within(leg).findByTestId("shipment-outbound-track", {}, { timeout: 4000 });
    await expectTheLink(below, resi);
    await expect(within(leg).getByRole("button", { name: new RegExp(resi) })).toBeInTheDocument();
  },
};

/** THE SAME, ON A PHONE (390): the link wraps under the resi when the line is full, never over it. */
export const SellerPhone: Story = {
  name: "Seller — phone",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByTestId("order-reference-track", {}, { timeout: 4000 });
    await expectTheLink(top, order101().receiptCode);

    const reference = canvas.getByTestId("order-reference-receipt");
    await expect(reference.scrollWidth).toBeLessThanOrEqual(reference.clientWidth + 1);
  },
};

/**
 * THE RESI IS URL-ENCODED — a resi as somebody typed it, with a space, `/`, `#` and `&`: the link still opens the
 * courier's page on THAT number (`JP%2012%2F34%235%26x`), never a page the stray characters point somewhere else.
 */
export const TheResiIsUrlEncoded: Story = {
  name: "The resi is URL-encoded into the link",
  beforeEach: resiOf101("JP 12/34#5&x"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByTestId("order-reference-track", {}, { timeout: 4000 });

    await expect(top).toHaveAttribute("href", "https://www.jne.co.id/en/tracking/trace?awb=JP%2012%2F34%235%26x");
    await expect(await canvas.findByTestId("shipment-outbound-track")).toHaveAttribute("href", top.getAttribute("href")!);
  },
};

/** A COURIER WITH NO LINK (SiCepat): the resi shows, copyable as before, and no link anywhere. */
export const NoLinkWhenTheCourierHasNone: Story = {
  name: "Seller — a courier with no link shows the resi without one",
  render: () => <At102 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resi = order102().receiptCode;

    const reference = await sellerCatalogueRead(canvasElement, "sicepat");
    await waitFor(() => expect(within(reference).getByRole("button", { name: new RegExp(resi) })).toBeVisible());
    await expect(canvas.queryByTestId("order-reference-track")).toBeNull();
    await expect(canvas.queryByTestId("shipment-outbound-track")).toBeNull();
  },
};

/** NO COURIER HAS A LINK — what the migration leaves: JNE's order reads its resi copyable, with no link. */
export const NoLinkWhenNoCourierHasOne: Story = {
  name: "Seller — no courier has a link: the resi alone",
  beforeEach: () => trackingLinksForStory({}),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reference = await sellerCatalogueRead(canvasElement, "jne");

    await waitFor(() => expect(within(reference).getByRole("button", { name: new RegExp(order101().receiptCode) })).toBeVisible());
    await expect(canvas.queryByTestId("order-reference-track")).toBeNull();
    await expect(canvas.queryByTestId("shipment-outbound-track")).toBeNull();
  },
};

/** AN ORDER WITH NO RESI: the reference reads `—` as before, and there is nothing to link. */
export const NoLinkWithoutAResi: Story = {
  name: "Seller — no resi, no link",
  beforeEach: resiOf101(""),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reference = await canvas.findByTestId("order-reference-receipt", {}, { timeout: 4000 });

    await waitFor(() => expect(reference).toHaveTextContent("—"));
    // The leg names the courier once the catalogue is read — the links are known by then.
    await waitFor(() => expect(canvas.getByTestId("shipment-outbound")).toHaveTextContent("JNE"), { timeout: 4000 });
    await expect(canvas.queryByTestId("order-reference-track")).toBeNull();
    await expect(canvas.queryByTestId("shipment-outbound-track")).toBeNull();
  },
};

/** A DELETED COURIER (POS) — its old order still opens its page (a-deleted-channel-still-resolves-by-id). */
export const ADeletedCouriersLinkStillOpens: Story = {
  name: "Seller — a deleted courier's link still opens",
  beforeEach: courierOf101(94n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByTestId("order-reference-track", {}, { timeout: 4000 });
    await expectTheLink(top, order101().receiptCode, POS_LINK);
  },
};

/**
 * THE WAREHOUSE'S DETAIL — its Info tab names the courier and, beside it, the resi: copyable, with the link. The
 * warehouse follows a parcel that left its building from here (a return, a lost parcel, a buyer's complaint passed on by
 * the seller).
 */
export const WarehouseSeesTheResiAndTheLink: Story = {
  name: "Warehouse — the resi beside the courier, with the link",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resi = order101().receiptCode;

    const field = await canvas.findByTestId("order-detail-resi", {}, { timeout: 4000 });
    await expect(within(field).getByRole("button", { name: new RegExp(resi) })).toBeVisible();
    const link = await within(field).findByTestId("order-detail-resi-track", {}, { timeout: 4000 });
    await expectTheLink(link, resi);
    await expect(link).toHaveTextContent("Track on the courier's site");
  },
};

/** THE SAME, ON A PHONE (390). */
export const WarehousePhone: Story = {
  name: "Warehouse — phone",
  beforeEach: asTeam(WAREHOUSE.id),
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = await canvas.findByTestId("order-detail-resi-track", {}, { timeout: 4000 });
    await expectTheLink(link, order101().receiptCode);
  },
};

/** THE WAREHOUSE, A COURIER WITH NO LINK (SiCepat): the resi, copyable, and no link. */
export const WarehouseNoLinkWhenTheCourierHasNone: Story = {
  name: "Warehouse — a courier with no link shows the resi without one",
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <At102 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByTestId("order-detail-resi", {}, { timeout: 4000 });
    await warehouseCatalogueRead(canvasElement);

    await expect(within(field).getByRole("button", { name: new RegExp(order102().receiptCode) })).toBeVisible();
    await expect(canvas.queryByTestId("order-detail-resi-track")).toBeNull();
  },
};

/** THE WAREHOUSE, AN ORDER WITH NO RESI: the RESI field reads `—`, and there is nothing to link. */
export const WarehouseNoResi: Story = {
  name: "Warehouse — no resi reads —, no link",
  beforeEach: [asTeam(WAREHOUSE.id), resiOf101("")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await warehouseCatalogueRead(canvasElement);

    await expect(canvas.queryByTestId("order-detail-resi")).toBeNull();
    await expect(canvas.queryByTestId("order-detail-resi-track")).toBeNull();
    await expect(canvas.getByText("Tracking no.").parentElement!).toHaveTextContent("—");
  },
};

/** SELLER'S OWN PAGE — standing as the selling team, for the record: the seller's detail has no RESI field of the warehouse's. */
export const SellerHasNoWarehouseResiField: Story = {
  name: "Seller — the warehouse's RESI field is not on the seller's page",
  beforeEach: asTeam(SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("order-reference-track", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("order-detail-resi")).toBeNull();
  },
};
