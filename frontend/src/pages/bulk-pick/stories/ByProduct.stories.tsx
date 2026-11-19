import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { statusChangeScenario } from "../../../../.storybook/sessionScenario";
import { BulkPickPage } from "../index";
import {
  A_01_1,
  A_01_2,
  B_02_1,
  DESKTOP,
  KAOS_HITAM,
  KAOS_PUTIH,
  KEMEJA,
  PHONE,
  SCENE_PATH,
  TOPI,
  VIEWPORTS,
  bulkPickPage,
  bulkPickScene,
  fitsTheScreen,
  loaded,
  rackOf,
} from "./kit";

// PER PRODUK — *each product shown with total quantity and its racks · order stays processed* (acceptance
// inventory/order.md, bulk pick order, grouped by product). the-bulk-pick-list-prototype-is-accepted —
// the page's real reads against the stub transport.

const Page = bulkPickPage(SCENE_PATH);

const meta = {
  title: "Pages/Warehouse/BulkPick/By product",
  component: BulkPickPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: bulkPickScene,
  render: () => <Page />,
} satisfies Meta<typeof BulkPickPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * EACH PRODUCT ONCE, ITS TOTAL OVER EVERY ORDER, EACH RACK ONCE WITH ITS UNITS — Kaos Hitam M is wanted by four of the
 * five orders: 5 in all, 2 from A-01-1, 2 from A-01-2, 1 from B-02-1. Never one rack chosen for the picker.
 */
export const EachProductHasItsTotalAndRacks: Story = {
  name: "Each product, its total and its racks",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const kaos = canvas.getByTestId(`bulk-pick-product-${KAOS_HITAM}`);

    await expect(kaos).toHaveAttribute("data-total", "5");
    await expect(within(kaos).getByTestId(`bulk-pick-product-total-${KAOS_HITAM}`)).toHaveTextContent("5");
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_HITAM}-${A_01_1}`)).toEqual({ code: "A-01-1", quantity: 2 });
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_HITAM}-${A_01_2}`)).toEqual({ code: "A-01-2", quantity: 2 });
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_HITAM}-${B_02_1}`)).toEqual({ code: "B-02-1", quantity: 1 });
    await expect(within(kaos).getByTestId(`bulk-pick-product-rack-${KAOS_HITAM}`)).toHaveTextContent("A-01-1×2A-01-2×2B-02-1×1");
    await expect(canvas.getByTestId(`bulk-pick-product-orders-${KAOS_HITAM}`)).toHaveTextContent("for 4 orders");

    // The other seller's product stands on its own row — a product is its id, never its name.
    await expect(canvas.getByTestId(`bulk-pick-product-${KEMEJA}`)).toHaveAttribute("data-total", "1");
  },
};

/**
 * THE PILE AND THE UNKNOWN ARE SAID, NEVER LEFT BLANK — Kaos Putih L: 2 from B-02-1 and 1 still in the unplaced pile
 * (a real place, in words); Topi Rajut: 2 from A-01-2 and 1 its take recorded no rack for (an order from before stock
 * integration), as the single pick page says it.
 */
export const ThePileAndTheUnrecordedAreSaid: Story = {
  name: "Unplaced and unrecorded units are said",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`bulk-pick-product-${KAOS_PUTIH}`)).toHaveAttribute("data-total", "3");
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_PUTIH}-${B_02_1}`)).toEqual({ code: "B-02-1", quantity: 2 });
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_PUTIH}-0`)).toEqual({ code: "", quantity: 1 });
    await expect(canvas.getByTestId(`bulk-pick-product-rack-${KAOS_PUTIH}-0`)).toHaveTextContent("Unplaced×1");

    await expect(canvas.getByTestId(`bulk-pick-product-${TOPI}`)).toHaveAttribute("data-total", "3");
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${TOPI}-${A_01_2}`)).toEqual({ code: "A-01-2", quantity: 2 });
    const none = canvas.getByTestId(`bulk-pick-product-rack-${TOPI}-unrecorded`);
    await expect(none).toHaveAttribute("data-quantity", "1");
    await expect(none).toHaveTextContent("No recorded shelf ×1");
  },
};

/**
 * WALK ORDER — the products are listed by the first rack each is taken from (A-01-1, A-01-2, B-02-1 …), so the list reads
 * as one trip down the aisles; two starting at the same rack go by name.
 */
export const ListedInWalkOrder: Story = {
  name: "Listed in walk order",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    const rows = [...canvasElement.querySelectorAll("[data-testid^='bulk-pick-product-'][data-total]")].map((el) =>
      el.getAttribute("data-testid"),
    );

    await expect(rows).toEqual([
      `bulk-pick-product-${KAOS_HITAM}`,
      `bulk-pick-product-${TOPI}`,
      `bulk-pick-product-${KAOS_PUTIH}`,
      `bulk-pick-product-${KEMEJA}`,
    ]);
  },
};

/**
 * THE ORDERS STAY DIKONFIRMASI — the page says so, offers no move in either view (no Set Picked, no step change), and
 * reading both views moves nothing: no OrderStatusChange reaches the server.
 */
export const TheOrdersStayConfirmed: Story = {
  name: "The orders stay Dikonfirmasi",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("bulk-pick-stays-note")).toHaveTextContent("the orders stay Confirmed");
    await userEvent.click(canvas.getByTestId("bulk-pick-view-order"));
    await canvas.findByTestId("bulk-pick-by-order");
    await userEvent.click(canvas.getByTestId("bulk-pick-view-product"));
    await canvas.findByTestId("bulk-pick-by-product");

    for (const move of ["pick-order-advance", "pick-order-set-picked", "pick-queue-bulk-move"]) {
      await expect(canvas.queryByTestId(move)).toBeNull();
    }
    await expect(canvas.queryByRole("button", { name: /picked|confirm/i })).toBeNull();
    await expect(statusChangeScenario.calls).toEqual([]);
  },
};

/**
 * ON A 390 PHONE — a block per product: the name and code, the total big on the right, the racks wrapped under it;
 * nothing runs past the edge.
 */
export const OnAPhone: Story = {
  name: "Phone · a block per product",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("bulk-pick-by-product")).toHaveAttribute("data-layout", "blocks");
    await waitFor(() => expect(canvas.getByTestId(`bulk-pick-product-total-${KAOS_PUTIH}`)).toHaveTextContent("3"));
    await expect(rackOf(canvasElement, `bulk-pick-product-rack-${KAOS_PUTIH}-0`)).toEqual({ code: "", quantity: 1 });

    for (const block of canvasElement.querySelectorAll<HTMLElement>("[data-testid^='bulk-pick-product-'][data-total]")) {
      await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
    }
    await fitsTheScreen();
  },
};
