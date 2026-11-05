import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SUPPLIER_DISCOVER_DETAIL_META, loaded } from "./stories/kit";

// DISCOVER SUPPLIER DETAIL — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under DiscoverSupplierDetail. The same title also holds the folders below, so Storybook draws
// DiscoverSupplierDetail as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Header  the name and whose it is, who it is, the warehouses over the tabs, the way back, a supplier that won't open
//   States  a supplier with no stores
//   Stores  the Stores tab — read-only, Sold and Ready, the search and the type filter
//   Tabs    Products, Statistics counting every team, what is marked, each tab's Export

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE: the name, the team, the identity line, then the tabs — the supplier page on a phone, read-only.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // Stacked on a phone: the identity line under the team.
    const team = (await canvas.findByTestId("discover-detail-team")).getBoundingClientRect();
    await expect(canvas.getByTestId("discover-detail-meta").getBoundingClientRect().top).toBeGreaterThanOrEqual(team.bottom);
  },
};
