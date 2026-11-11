import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FORM_META, loaded } from "./stories/kit";

// RESTOCK FORM — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// RestockForm (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws RestockForm as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Edit        an edit by status and by team — arrived keeps the lines, accepted is not editable
//   Navigation  Back and Save return where the form was opened
//   Payment     payment and parcel — the typed fields, and a resi or Order ID already on another restock
//   Products    the picker and the lines
//   States      the form as each person and status opens it
//   Summary     the money column — the checks, the line over Buat Restok, the totals, the note, the button
//   Supplier    the supplier part of the Produk card — one for all, or a line's own

const meta = {
  title: "Pages/Inventory/Restock/RestockForm",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new restock, as the selling team's owner. */
export const Default: Story = {};

// A PHONE (every-page-has-a-mobile-story) — one column; nothing runs past the screen's edge
// (nothing-runs-past-a-phones-edge), the empty Produk card offers the picker.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await expect(within(canvas.getByTestId("restock-no-products")).getByTestId("restock-pick-products")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
