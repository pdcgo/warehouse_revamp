import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the lock in the row (one-lock-three-ways): read there and edited from its popover, a minimum above the
// stock badged as locked now, and the warehouse lens hiding that badge. The page's stories are grouped by the part of
// the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Lock",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open the lock's popover on a row and wait for it — it portals, so it is found on `screen`. */
async function openLock(canvas: ReturnType<typeof within>, sku: string) {
  await userEvent.click(canvas.getByTestId(`lock-${sku}`));
  const panel = await screen.findByTestId(`lock-${sku}-panel`);
  await waitFor(() => expect(panel).toBeVisible());
  return within(panel);
}

/** THE LOCK IS ONE SETTING, THREE WAYS (one-lock-three-ways), read on the row and edited from it — a popover, not a trip
 * into the product, and the row does not open under it. 700 has a minimum of 4; Always keeps it. */
export const TheLockIsEditedInTheRow: Story = {
  name: "Edited in the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("lock-SKU-ANG-001")).toHaveTextContent("Min 4 pcs");
    await expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Open");

    const panel = await openLock(canvas, "SKU-ANG-001");
    await expect(panel.getByTestId("lock-SKU-ANG-001-field-minimum")).toHaveValue("4");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-001-field-mode-always"));
    await expect(panel.queryByTestId("lock-SKU-ANG-001-field-minimum")).toBeNull();
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-001-save"));

    await waitFor(() => expect(canvas.getByTestId("lock-SKU-ANG-001")).toHaveTextContent("Always locked"));
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();

    // Back to the minimum — the 4 was kept.
    const again = await openLock(canvas, "SKU-ANG-001");
    await userEvent.click(again.getByTestId("lock-SKU-ANG-001-field-mode-min"));
    await expect(again.getByTestId("lock-SKU-ANG-001-field-minimum")).toHaveValue("4");
  },
};

/** A minimum above the stock on hand closes the product to other teams NOW — the row says so with a badge. SKU-ANG-002
 * holds 43 ready; a minimum of 50 is in force. A minimum needs at least 1 to be saved. */
export const AMinimumAboveTheStockLocksItNow: Story = {
  name: "Minimum above the stock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("lock-SKU-ANG-002-now")).toBeNull();

    const panel = await openLock(canvas, "SKU-ANG-002");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-field-mode-min"));
    await expect(panel.getByTestId("lock-SKU-ANG-002-save")).toBeDisabled();
    await userEvent.type(panel.getByTestId("lock-SKU-ANG-002-field-minimum"), "50", { delay: 30 });
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-save"));

    await waitFor(() => expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Min 50 pcs"));
    await expect(await canvas.findByTestId("lock-SKU-ANG-002-now")).toHaveTextContent("Locked");
  },
};

/** Under a warehouse lens the badge is not drawn — the minimum reads the TOTAL stock, and the row then holds one
 * building's. The setting itself still shows. */
export const TheLensHidesTheBadge: Story = {
  name: "Lens hides the badge",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const panel = await openLock(canvas, "SKU-ANG-002");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-field-mode-min"));
    await userEvent.type(panel.getByTestId("lock-SKU-ANG-002-field-minimum"), "50", { delay: 30 });
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-save"));
    await canvas.findByTestId("lock-SKU-ANG-002-now");

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.queryByTestId("lock-SKU-ANG-002-now")).toBeNull());
    await expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Min 50 pcs");
  },
};
