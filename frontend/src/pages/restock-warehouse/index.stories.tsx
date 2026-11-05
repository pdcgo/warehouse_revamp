import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { WAREHOUSE_META, loaded } from "./stories/kit";

// RESTOCK WAREHOUSE — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// RestockWarehouse (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws RestockWarehouse as a folder with these two stories leading it. Its rules are grouped by the part of
// the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     the row's acts at the door, by status, and what they run
//   Filters     the status tabs, the filters in the URL, the empty hint
//   Rows        the screen's own rules and what a row shows
//   Summary     the card strip — the queue still to do, and the COD this warehouse paid

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block, every-page-has-a-mobile-story) — no headings;
// the number, its status and when; from whom; the courier and the tracking number; what is in it; the acts at the door,
// named. The filters are a sheet (a-phone-filters-from-a-sheet), and nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("restock-inbound-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const row = canvas.getByTestId("restock-row-501");
    await expect(row).toHaveTextContent("Toko Melati");
    await expect(within(row).getByTestId("restock-receipt-501")).toHaveTextContent("JNE0123456789");
    await expect(within(row).getByTestId("restock-action-sign-501")).toBeVisible();
    await expect(within(row).getByTestId("restock-action-accept-501")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await userEvent.click(canvas.getByTestId("restock-inbound-filter-open"));
    const sheet = await screen.findByTestId("restock-inbound-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    for (const id of ["restock-inbound-from", "restock-inbound-person"]) {
      await expect(within(sheet).getByTestId(id)).toBeVisible();
    }
  },
};
