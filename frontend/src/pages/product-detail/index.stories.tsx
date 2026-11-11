import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PRODUCT_DETAIL_META, loaded } from "./stories/kit";

// PRODUCT DETAIL — the page as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// ProductDetail. The same title also holds the folders below, so Storybook draws ProductDetail as a folder with these two
// stories leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Header     the name and its SKU, the sticky bar, Back, another team's product
//   Actions    Edit, and the order and restock forms the page opens
//   Archive    an archived product — Archive, Restore, Back to the archive
//   Sections   one page of sections, the gaps marked, the sample rows, a Batch row
//   Info       the stock headline and its chip, the record, the markup and the lock
//   Warehouse  the picker and the warehouse card's tabs

const meta = {
  title: "Pages/Products/ProductDetail",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A phone — one row of header with the actions in ⋯ and the section chips under it, the sections in one column. */
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
  },
};
