import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIERS_META, SINAR, SUMBER, loaded } from "./stories/kit";

// SUPPLIERS — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// Suppliers. The same title also holds the folders below, so Storybook draws Suppliers as a folder with these two
// stories leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions  New Supplier, a row's Edit and its Delete
//   Figures  Sold and Ready — the columns, real, and their range filters
//   Filters  the search, the store type, the warehouse, and the filters in the URL
//   Rows     the columns and what a row shows — whose suppliers, the stores, the contact, the sort, the pager
//   States   a warehouse team's page, which keeps no suppliers

const meta = {
  title: "Pages/Suppliers/Suppliers",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block) — the name and its stores, or words saying
// it has none; no contact, no address; no headings, so the sort is the Filter sheet's, with the store type.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("suppliers-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    // Its name and its stores — no contact, no address (a-phone-supplier-is-its-name-and-stores).
    await expect(sumber).not.toHaveTextContent(SUMBER.contact);
    await expect(sumber).not.toHaveTextContent(SUMBER.address);
    // A supplier with no store says so in words, not a dash.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}-no-stores`)).toHaveTextContent("No supplier stores yet");

    await userEvent.click(canvas.getByTestId("suppliers-filter-open"));
    const sheet = await screen.findByTestId("suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("supplier-sort-select")).toBeVisible();
    await expect(within(sheet).getByTestId("marketplace-select")).toBeVisible();
  },
};
