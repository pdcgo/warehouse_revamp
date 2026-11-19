import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { BulkPickPage } from "../index";
import {
  A_01_1,
  A_01_2,
  B_02_1,
  DESKTOP,
  KAOS_HITAM,
  KAOS_PUTIH,
  PHONE,
  SCENE,
  SCENE_PATH,
  TOPI,
  VIEWPORTS,
  bulkPickPage,
  bulkPickScene,
  fitsTheScreen,
  loaded,
  rackOf,
} from "./kit";

// PER PESANAN — *each order shown with its products and racks* (acceptance inventory/order.md, bulk pick order, grouped
// by order). the-bulk-pick-list-prototype-is-accepted — the page's real reads against the stub transport.

const ByOrder = bulkPickPage(`${SCENE_PATH}&view=order`);
const ByProduct = bulkPickPage(SCENE_PATH);
// Opened from the list's Dikonfirmasi tab with a search typed — Back must return to exactly that.
const FromTheList = bulkPickPage({
  pathname: "/warehouse-orders/bulk-pick",
  search: `?ids=${SCENE.join(",")}&view=order`,
  state: { from: "/warehouse-orders?step=confirm&q=SP-2409" },
});
const NoIds = bulkPickPage("/warehouse-orders/bulk-pick");

const meta = {
  title: "Pages/Warehouse/BulkPick/By order",
  component: BulkPickPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: bulkPickScene,
  render: () => <ByOrder />,
} satisfies Meta<typeof BulkPickPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * EACH ORDER WITH ITS PRODUCTS AND RACKS, in the order they were ticked — 101's three lines each with the racks ITS take
 * drew from (Kaos Hitam M from A-01-1 and A-01-2, Kaos Putih L from the unplaced pile, Topi Rajut with no recorded rack),
 * never the other orders' racks.
 */
export const EachOrderHasItsProductsAndRacks: Story = {
  name: "Each order, its products and racks",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("bulk-pick-by-order");

    const listed = [...canvasElement.querySelectorAll("[data-testid^='bulk-pick-order-']")]
      .map((el) => el.getAttribute("data-testid")!)
      .filter((id) => /^bulk-pick-order-\d+$/.test(id));
    await expect(listed).toEqual(SCENE.map((id) => `bulk-pick-order-${id}`));

    const first = canvas.getByTestId("bulk-pick-order-101");
    await expect(within(first).getByTestId("bulk-pick-order-units-101")).toHaveTextContent("4 units");
    await expect(within(first).getByTestId(`bulk-pick-order-line-101-${KAOS_HITAM}`)).toHaveAttribute("data-quantity", "2");
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-101-${KAOS_HITAM}-${A_01_1}`)).toEqual({ code: "A-01-1", quantity: 1 });
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-101-${KAOS_HITAM}-${A_01_2}`)).toEqual({ code: "A-01-2", quantity: 1 });
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-101-${KAOS_PUTIH}-0`)).toEqual({ code: "", quantity: 1 });
    await expect(canvas.getByTestId(`bulk-pick-order-rack-101-${TOPI}-unrecorded`)).toHaveAttribute("data-quantity", "1");
    // 101's Kaos Hitam M is not on B-02-1 — that is 102's.
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-101-${KAOS_HITAM}-${B_02_1}`)).toBeNull();
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-102-${KAOS_HITAM}-${B_02_1}`)).toEqual({ code: "B-02-1", quantity: 1 });

    // Each order names itself as its parcel does: the shop, the marketplace ref.
    await expect(first).toHaveTextContent("Melati Official");
    await expect(first).toHaveTextContent("SP-2409-8841");
    await expect(canvas.getByTestId("bulk-pick-order-110")).toHaveTextContent("Kenanga Official");
    await fitsTheScreen();
  },
};

/**
 * THE VIEW IS A LINE TAB, KEPT IN THE ADDRESS (a-page-picks-its-view-over-its-filters, a-lists-filters-live-in-the-url):
 * Per Pesanan writes `view=order` beside the ids and mounts only its list; Per Produk takes the key away again.
 */
export const TheViewIsATabKeptInTheAddress: Story = {
  name: "The view is a tab, kept in the address",
  globals: DESKTOP,
  render: () => <ByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("bulk-pick-by-product");
    await expect(canvas.queryByTestId("bulk-pick-by-order")).toBeNull();

    await userEvent.click(canvas.getByTestId("bulk-pick-view-order"));
    await canvas.findByTestId("bulk-pick-by-order");
    await waitFor(() => expect(canvas.queryByTestId("bulk-pick-by-product")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("view=order"));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(`ids=${SCENE.join("%2C")}`);

    await userEvent.click(canvas.getByTestId("bulk-pick-view-product"));
    await canvas.findByTestId("bulk-pick-by-product");
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("view="));
  },
};

/** BUKA OPENS THAT ORDER'S PICK PAGE — where its parcel is still checked item by item before Sudah diambil. */
export const OpenGoesToTheOrdersPickPage: Story = {
  name: "Open goes to the order's pick page",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("bulk-pick-order-open-103"));
    await canvas.findByTestId("at-pick-order");
  },
};

/** BACK RETURNS WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list's tab and its search. */
export const BackReturnsWhereItWasOpened: Story = {
  name: "Back returns where it was opened",
  globals: DESKTOP,
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("bulk-pick-back"));
    await canvas.findByTestId("at-list");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?step=confirm&q=SP-2409");
  },
};

/** NO IDS — the page says nothing was chosen, and its button goes back to the Dikonfirmasi tab. */
export const NoOrdersChosen: Story = {
  name: "No orders chosen",
  globals: DESKTOP,
  render: () => <NoIds />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("bulk-pick-empty")).toHaveTextContent("No orders chosen");
    await expect(canvas.queryByTestId("bulk-pick-tabs")).toBeNull();
    await userEvent.click(canvas.getByTestId("bulk-pick-empty-back"));
    await canvas.findByTestId("at-list");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?step=confirm");
  },
};

/** ON A 390 PHONE — a block per order: its head (shop, ref, courier, resi, Buka), then each line with its racks. */
export const OnAPhone: Story = {
  name: "Phone · a block per order",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(await canvas.findByTestId("bulk-pick-by-order")).toHaveAttribute("data-layout", "blocks");
    await expect(rackOf(canvasElement, `bulk-pick-order-rack-104-${KAOS_PUTIH}-${B_02_1}`)).toEqual({ code: "B-02-1", quantity: 2 });

    for (const id of SCENE) {
      const block = canvas.getByTestId(`bulk-pick-order-${id}`);
      await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
    }
    await fitsTheScreen();
  },
};
