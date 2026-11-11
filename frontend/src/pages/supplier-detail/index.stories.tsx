import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { SUPPLIER_DETAIL_META, loaded } from "./stories/kit";

// SUPPLIER DETAIL — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// SupplierDetail. The same title also holds the folders below, so Storybook draws SupplierDetail as a folder with
// these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Header        who the supplier is, its own Edit and Delete, the way back, a supplier read-only or gone
//   Products      the Products tab — sample rows, the search, the pager, Sold and Ready
//   States        a website only, no stores yet, more stores than a page
//   StoreActions  Add Store and its examples, a store's Delete
//   Stores        the Stores tab — a row, its Sold and Ready, the search, the type filter, the pager
//   Tabs          the three tabs and their one underline, what is marked, each tab's Export
//   Warehouses    the warehouse chips over the tabs, and their summary

const meta = {
  title: "Pages/Suppliers/SupplierDetail",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE KEEPS THE HEADER ONE ROW (the-phone-header-is-one-row) — the name and Ubah and Hapus as their ICONS, two so no
// ⋯ (a-phone-header-action-is-an-icon); the line of who the supplier is under it.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-detail-menu")).toBeNull();
    const edit = canvas.getByRole("button", { name: "Edit" });
    await expect(edit).toHaveAttribute("data-testid", "supplier-detail-edit");
    await expect(edit).not.toHaveTextContent("Edit");
    const name = canvas.getByTestId("supplier-detail-name").getBoundingClientRect();
    await expect(edit.getBoundingClientRect().top).toBeLessThan(name.bottom);

    await userEvent.click(canvas.getByTestId("supplier-detail-delete"));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeVisible());
  },
};
