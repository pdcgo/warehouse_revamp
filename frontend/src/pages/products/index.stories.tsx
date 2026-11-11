import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PRODUCTS_META, loaded } from "./stories/kit";

// PRODUCTS — the list as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under Products. The
// same title also holds the folders below, so Storybook draws Products as a folder with these two stories leading it.
// Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   States   the archive
//   Header   the page's name, the catalogue's figures, the card strip
//   Filters  the warehouse lens, the search, the lock and age filters, the empty hint, the URL
//   Rows     what a row shows — the dates, the cost range, the cross price, the product code — its sort and its hover
//   Lock     the lock, edited in the row
//   Archive  the archive's own page, Archive, Unarchive and Delete
//   Actions  the row, Edit and New Product opening their pages — and none of them while monitoring
//   Warehouse  a warehouse's Products — what it holds, a different screen on the same path

const meta = {
  title: "Pages/Products/Products",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A phone — the same table, as the screen stands today (it has no phone arrangement of its own yet). */
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("open-create-product")).toBeVisible();
  },
};
