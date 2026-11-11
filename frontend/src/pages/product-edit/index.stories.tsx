import type { Meta, StoryObj } from "@storybook/react-vite";

import { AtEditMinyak, PRODUCT_FORM_META, loadedMinyak } from "./stories/kit";

// PRODUCT FORM — the page as it is, on a desktop and on a phone: Default (a new product) and Mobile sit FIRST, straight
// under ProductForm. The same title also holds the folders below, so Storybook draws ProductForm as a folder with these
// two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   States   an edit, filled from the record
//   Fields   the fields — filled on an edit, their examples, the team's code in front, their limits, the lock and its minimum
//   Save     what Save waits for, what it sends, what it refuses
//   Gallery  the cover and four — dropped files, the cover, a picture from the web
//   Back     where Back and Save return — the product, the filtered list, the list

// "ProductForm" (owner: *"di story jadi form aja namanya"*): one page creates AND edits a product, so the sidebar names
// it for what it is rather than for one of its two routes.
const meta = {
  title: "Pages/Products/ProductForm",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new product — an empty form. */
export const Default: Story = {};

/** A phone — the same form in one column, as the screen stands today. */
export const Mobile: Story = {
  name: "Mobile",
  render: () => <AtEditMinyak />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await loadedMinyak(canvasElement);
  },
};
