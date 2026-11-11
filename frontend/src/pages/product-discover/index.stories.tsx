import type { Meta, StoryObj } from "@storybook/react-vite";

import { DISCOVER_PRODUCTS_META, withALockedProduct } from "./stories/kit";

// DISCOVER PRODUCTS — the browse as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// DiscoverProducts. The same title also holds the folders below, so Storybook draws DiscoverProducts as a folder with
// these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Cards    what a card shows — its owner, its price, its badges, its stock — and where it opens
//   Filters  the panel beside the grid, the division chips, the ranges, the lock filter, the phone's sheet
//   Search   the search and the sort over the grid, in the URL, and nothing matching
//   Grid     paging through the catalogue, and no team to browse for

const meta = {
  title: "Pages/Products/DiscoverProducts",
  ...DISCOVER_PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { beforeEach: withALockedProduct };

// A PHONE (every-page-has-a-mobile-story): no panel — the search and a Filter button, the division chips in one row
// that scrolls, and two cards a row.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  beforeEach: withALockedProduct,
};
