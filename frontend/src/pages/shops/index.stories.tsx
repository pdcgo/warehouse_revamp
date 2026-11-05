import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { SHOPS_META, loaded } from "./stories/kit";

// SHOPS — the list as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under Shops. The same
// title also holds the folders below, so Storybook draws Shops as a folder with these two stories leading it. Its rules
// are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     New Shop, Edit and Delete
//   Filters     the search, the marketplace and primary CS filters, the URL, the empty hint
//   Primary CS  its column, and Change Primary CS from the row's ⋯
//   Rows        what a row shows, its sort, and how it opens the shop

const meta = {
  title: "Pages/Shops/Shops",
  ...SHOPS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A phone — each shop a block (no table headings), New Shop its ＋ alone on the title's row, Edit and Delete at each
 * block's foot (a-phone-reads-each-line-as-a-block, a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("shops-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const create = canvas.getByRole("button", { name: "New Shop" });
    await expect(create).toHaveAttribute("data-testid", "open-create-shop");
    await expect(create).not.toHaveTextContent("New Shop");
    await expect(within(canvas.getByTestId("shop-row-MEL-SHP")).getByTestId("edit-MEL-SHP")).toBeVisible();
    await expect(within(canvas.getByTestId("shop-row-MEL-SHP")).getByTestId("shop-actions-MEL-SHP")).toBeVisible();
    // The primary CS by name alone — no "Primary CS ·" before it.
    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent(/^Ani Rahayu$/));
  },
};
