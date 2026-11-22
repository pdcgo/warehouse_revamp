import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders } from "../../../.storybook/fixtures";
import { DESKTOP, PHONE, TAG_VIEWPORTS } from "../../../.storybook/restockTagKit";
import { channelTrackingUrls, trackingLinksForStory } from "../../../.storybook/trackingLinkStub";
import { loadShippingCatalogue } from "../../features/shipping/catalogue";
import { OrdersPage } from "./index";

// THE SELLER'S ORDER LIST — THE RESI CELL LINKS TO THE COURIER'S PAGE (the-tracking-link-prototype-is-accepted, the
// list's ↗ included). The Resi column's copyable number gets a ↗ on the SAME line (one-context-per-column-and-never-
// three-lines: the cell stays one line), the icon alone — its words, *Track on the courier's site*, are its label and
// tooltip. Clicking it opens the courier's page in a new tab and does NOT open the order (the row's own click). A courier
// with no link (SiCepat) keeps the plain cell. The link comes from the shared courier catalogue — the one channel read the
// list already makes for its Kurir column — so the rows cost no request of their own.
//
// Against the real stub: the couriers start each story with the links of `.storybook/trackingLinkStub.ts`.

const Routed = routedPage(
  [
    {
      path: "/orders",
      element: (
        <>
          <OrdersPage />
          <LocationProbe hidden />
        </>
      ),
    },
    marker("/orders/:orderId", "at-order-detail"),
  ],
  "/orders",
);

const meta = {
  title: "Pages/Order/SellerOrderListPage/Tracking link",
  component: OrdersPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: TAG_VIEWPORTS } },
  beforeEach: [asTeam(12n), () => trackingLinksForStory()],
  globals: DESKTOP,
  render: () => <Routed />,
} satisfies Meta<typeof OrdersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const JNE_LINK = channelTrackingUrls.find((c) => c.code === "jne")!.trackingUrl;
const resiOf = (id: bigint) => orders.find((o) => o.id === id)!.receiptCode;

/**
 * Waits until the courier catalogue (where the links come from) has landed and the rows have drawn from it — so a
 * "no ↗" check is not passed by a list that simply has not read the links yet.
 */
async function catalogueDrawn() {
  await loadShippingCatalogue();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * A JNE ROW (101) — the resi, its copy, and a ↗ on the same line opening JNE's page on that resi in a new tab. Clicking
 * the ↗ leaves the list where it is: the row's click (open the order) never fires.
 */
export const TheResiCellLinks: Story = {
  name: "A JNE row — ↗ after the resi, same line; it does not open the order",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });

    const link = await within(row).findByTestId("order-receipt-track", {}, { timeout: 4000 });
    await expect(link).toHaveAttribute("href", JNE_LINK.replace("{resi}", encodeURIComponent(resiOf(101n))));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAccessibleName("Track on the courier's site");
    await expect(within(row).getByTestId("order-receipt")).toBeVisible();

    // ONE LINE: the ↗ sits beside the copy, not under it.
    const copy = within(row).getByTestId("order-receipt").getBoundingClientRect();
    const icon = link.getBoundingClientRect();
    await expect(Math.abs(icon.top + icon.height / 2 - (copy.top + copy.height / 2))).toBeLessThan(4);

    // The browser's own new tab is not the story's business — only that the ROW's click does not fire.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await userEvent.click(link);
    await expect(canvas.queryByTestId("at-order-detail")).toBeNull();
    await expect(canvas.getByTestId("order-row-101")).toBeInTheDocument();
  },
};

/** A SICEPAT ROW (102) — its courier has no link: the cell is today's, the resi copyable and nothing more. */
export const NoLinkForACourierWithNone: Story = {
  name: "A SiCepat row — no link, the plain cell",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId("order-row-102", {}, { timeout: 4000 });
    // The JNE row's ↗ has landed, so the links are read — SiCepat's row is drawn from the same catalogue.
    await within(canvas.getByTestId("order-row-101")).findByTestId("order-receipt-track", {}, { timeout: 4000 });

    await expect(within(row).getByTestId("order-receipt")).toHaveTextContent(resiOf(102n));
    await expect(within(row).queryByTestId("order-receipt-track")).toBeNull();
  },
};

/** A `beforeEach` shipping 101 by another courier for one story; the fixture is put back after. */
const courierOf101 = (channelId: bigint) => () => {
  const row = orders.find((o) => o.id === 101n)!;
  const saved = row.shipmentChannelId;
  row.shipmentChannelId = channelId;
  return () => {
    row.shipmentChannelId = saved;
  };
};

/**
 * A DELETED COURIER (POS, 94) — its old order still opens its page (a-deleted-channel-still-resolves-by-id): the
 * catalogue the list reads holds deleted couriers too, with their links.
 */
export const ADeletedCouriersLinkStillOpens: Story = {
  name: "A deleted courier's row — its link still opens",
  beforeEach: courierOf101(94n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });
    const POS_LINK = channelTrackingUrls.find((c) => c.code === "pos")!.trackingUrl;

    const link = await within(row).findByTestId("order-receipt-track", {}, { timeout: 4000 });
    await expect(link).toHaveAttribute("href", POS_LINK.replace("{resi}", encodeURIComponent(resiOf(101n))));
  },
};

/** THE SAME LIST ON A PHONE (390) — it stays a table; the ↗ rides the resi's line. */
export const Phone: Story = {
  name: "Phone",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });
    await expect(await within(row).findByTestId("order-receipt-track", {}, { timeout: 4000 })).toBeInTheDocument();
  },
};

/** NO COURIER HAS A LINK — what the migration leaves: every Resi cell is the copyable number alone. */
export const NoCourierHasALink: Story = {
  name: "No courier has a link — no ↗ in any row",
  beforeEach: () => trackingLinksForStory({}),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });
    await catalogueDrawn();

    await expect(canvas.queryAllByTestId("order-receipt").length).toBeGreaterThan(0);
    await expect(canvas.queryAllByTestId("order-receipt-track")).toHaveLength(0);
  },
};
