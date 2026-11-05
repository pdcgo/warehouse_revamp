import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SUPPLIER_DISCOVER_META, loaded } from "./stories/kit";

// DISCOVER SUPPLIERS — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// DiscoverSuppliers. The same title also holds the folders below, so Storybook draws DiscoverSuppliers as a folder
// with these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Cards    a card — who, whose and where, its contact, its figures
//   Filters  the warehouse, the team, the Sold and Ready ranges, the store-type chips — and on a phone the sheet
//   Rows     every team's suppliers, cards first or a table, the pager, where a row opens
//   Search   what the search reads and what it does not, and the filters in the URL
//   Table    the table view — a row lighting up, the description, the figures last

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE ALWAYS READS CARDS — one column, the cards are its blocks — so it has no Cards/Table switch.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards");
    await expect(canvas.queryByTestId("discover-suppliers-view")).toBeNull();
  },
};
