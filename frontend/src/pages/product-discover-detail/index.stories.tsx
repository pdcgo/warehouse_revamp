import type { Meta, StoryObj } from "@storybook/react-vite";

import { DISCOVER_PRODUCT_DETAIL_META } from "./stories/kit";

// DISCOVER PRODUCT DETAIL — the page as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under DiscoverProductDetail. The same title also holds the folders below, so Storybook draws DiscoverProductDetail as a
// folder with these two stories leading it. Its rules are grouped by the part of the screen they are about, one file
// each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   States     with a reserve, your own product, locked, archived
//   Header     the owner's page's shape, the way to your own page, Back, an unknown id
//   Info       the team, the picture and the derived products, the cross price, the ready figure
//   Badges     the title's badges — the division, the lock, archived
//   Price      Harga per Gudang — a row and a price per warehouse
//   Warehouse  Per Gudang — the overview under the picker, the suppliers, the stock history
//   Order      Buat Pesanan, and when it is held back

const meta = {
  title: "Pages/Products/DiscoverProductDetail",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ⚠ NO `play()`: the `viewport` global resizes the workbench canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories). For looking — the section chips stick, each warehouse is a block.
export const Mobile: Story = { globals: { viewport: { value: "mobile2" } } };
