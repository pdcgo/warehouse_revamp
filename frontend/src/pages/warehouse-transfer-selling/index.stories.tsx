import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { fitsTheScreen, tabsDoNotOverlap } from "../../features/warehouseTransfer/storyPhone";
import { SELLING_META, loaded } from "./stories/kit";

// THE TEAM'S TRANSFER LIST — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under TransferSelling. The same title also holds the folders below, so Storybook draws TransferSelling as a folder with
// these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Rows        what a desktop row shows, what it opens, its ⋯
//   Filters     the status tabs, the filters in the URL, the empty hint, the growing pager
//   Phone       a block per transfer at 390 and 320px (the-transfer-lists-read-as-blocks-on-a-phone)

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferSelling",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS EACH TRANSFER AS A BLOCK (the-transfer-lists-read-as-blocks-on-a-phone, every-page-has-a-mobile-story),
// at the 390px it was accepted at: the page names itself with New Transfer as its ＋; the search in the row, the
// warehouse in the sheet; the eight tabs on one row that slides, none shrinking into the next; a block per transfer; the
// growing pager, centred, no page size; and nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("transfers-table")).toHaveAttribute("data-layout", "phone");
    await expect(canvasElement.querySelector("table")).toBeNull();
    await expect(canvas.getByRole("heading", { name: "Transfers" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-transfer")).toHaveAccessibleName("New Transfer");
    await expect(canvas.getByTestId("transfer-search")).toBeVisible();
    await tabsDoNotOverlap(canvasElement);

    const block = canvas.getByTestId("transfer-row-603");
    await waitFor(() => expect(within(block).getByTestId("transfer-route-603")).toHaveTextContent(/Gudang Pusat.*Gudang Cabang/));
    await expect(within(block).getByTestId("transfer-actions-603")).toBeVisible();
    await fitsTheScreen(canvasElement);

    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await expect(canvas.queryByTestId("transfer-pager-size")).toBeNull();

    await userEvent.click(canvas.getByTestId("transfer-filters-open"));
    const sheet = await screen.findByTestId("transfer-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("transfer-warehouse-filter")).toBeVisible();
  },
};
