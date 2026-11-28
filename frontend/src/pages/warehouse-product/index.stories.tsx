import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { productPlacesForStory } from "../../../.storybook/batchStub";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { inventoryClient } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseProductPage } from "./index";

// ONE PRODUCT AS A WAREHOUSE HOLDS IT (#198) — Gudang Pusat's (11) Beras Pandan Wangi 5kg (74, Toko Melati's), read by
// its crew: what it is, where it sits, Move and Adjust. Beras holds 5 on A-01-1 and 2 on B-02-1 now (batchStub's
// `productPlacesForStory`). The tabs past Info read what the stub does not serve (cost layers, batches, the stock
// summary) — these stories are about the page's head and its racks.

const Routed = routedPage(
  [{ path: "/inventories/products/:productId", element: <WarehouseProductPage /> }, marker("/inventories/products", "at-products")],
  "/inventories/products/74",
);

const meta = {
  title: "Pages/Inventory/Products/WarehouseProduct",
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    productPlacesForStory({ "74": [[41n, 5n], [43n, 2n]] });
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("warehouse-product-page", {}, { timeout: 5000 });
  return canvas;
}

/** The product, and the two things a person at the shelf can do to it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("warehouse-product-page")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(canvas.getByTestId("warehouse-product-page")).toHaveTextContent("SKU-BERAS-5K");
    await expect(canvas.getByTestId("wp-action-move")).toBeVisible();
    await expect(canvas.getByTestId("wp-action-adjust")).toBeVisible();
  },
};

// A PHONE (every-page-has-a-mobile-story).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("wp-action-adjust")).toBeVisible();
  },
};

// THE PRODUCT'S RACKS ARE READ ONCE (#133, the-speed-audits-old-findings-are-fixed-smallest-first) — the page's own
// ProductPlaces gives Move and Adjust each rack's figure; the two dialogs, mounted closed beside the page, read the same
// ProductPlaces again on every load.
export const TheRacksAreReadOnce: Story = {
  name: "Racks read once",
  beforeEach: () => {
    const spy = spyOn(inventoryClient, "productPlaces");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("wp-action-adjust"));
    await waitFor(() => expect(screen.getByTestId("adjust-dialog")).toBeVisible());

    // A-01-1 reads the page's figure: a recount to 3 is 5 before, down 2 (the-adjust-preview-shows-its-working).
    const trigger = screen.getByTestId("rack-select");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await waitFor(() => expect(within(root).getByTestId("rack-select-option-41")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(within(root).getByTestId("rack-select-option-41"));
    await userEvent.clear(screen.getByTestId("adjust-amount"));
    await userEvent.type(screen.getByTestId("adjust-amount"), "3", { delay: 40 });
    await waitFor(() => expect(screen.getByTestId("adjust-delta-before")).toHaveTextContent(/^5$/));
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Decreased\s*−2$/);

    await expect((inventoryClient.productPlaces as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  },
};
