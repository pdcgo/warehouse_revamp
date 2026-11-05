import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SELLING_META, loaded } from "./stories/kit";

// RESTOCK SELLING — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// RestockSelling (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws RestockSelling as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     the row's ⋯, by status, and the acts it runs
//   Filters     the tabs, the search, the filters, the empty hint
//   Notes       Catatan from the row
//   Rows        the screen's own rules and what a row shows
//   Statistics  the Statistik panel

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block) — no headings; the number, its status and
// its ⋯, when and by whom, the supplier, the warehouse, then what is in it beside its value. The filters are a sheet,
// and New Restock is its ＋ (a-phone-filters-from-a-sheet, a-phone-header-action-is-an-icon).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("restock-requests-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const accepted = canvas.getByTestId("restock-row-503");
    await expect(within(accepted).getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(within(accepted).getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await waitFor(() => expect(within(accepted).getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    // FOUR LINES, THE REFERENCE LEADING (a-phone-restock-is-four-lines): the invoice and the tracking number, copyable;
    // the pieces; no store and no SKU — those are the detail page's.
    await expect(within(accepted).getByTestId("restock-invoice-503")).toHaveTextContent("INV/2026/09/0412");
    await expect(within(accepted).getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
    await expect(accepted).toHaveTextContent("30 pcs");
    await expect(accepted).not.toHaveTextContent("Sumber Makmur Store");
    await expect(accepted).not.toHaveTextContent("SKU-");
    await expect(within(canvas.getByTestId("restock-row-501")).getByTestId("restock-actions-501")).toBeVisible();
    await expect(canvas.getByTestId("open-create-restock")).toHaveAccessibleName("New Restock");

    await userEvent.click(canvas.getByTestId("restock-filter-open"));
    const sheet = await screen.findByTestId("restock-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    for (const id of ["restock-warehouse-filter", "restock-courier-filter", "restock-created-by-filter", "restock-accepted-by-filter"]) {
      await expect(within(sheet).getByTestId(id)).toBeVisible();
    }
  },
};
