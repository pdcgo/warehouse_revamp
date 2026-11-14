import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { fitsTheScreen, tabsDoNotOverlap } from "../../features/warehouseTransfer/storyPhone";
import { WAREHOUSE_META, loaded } from "./stories/kit";

// A WAREHOUSE'S TRANSFER QUEUE — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under TransferWarehouse. The same title also holds the folders below, so Storybook draws TransferWarehouse as a folder
// with these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Rows        what a desktop row shows — whose goods and who opened them — and the acts it runs
//   Filters     the direction, the status tabs, the filters in the URL, the empty hint, the growing pager
//   Phone       a block per transfer at 390 and 320px, its next act run from the block
//               (the-transfer-lists-read-as-blocks-on-a-phone)

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferWarehouse",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS EACH TRANSFER AS A BLOCK (the-transfer-lists-read-as-blocks-on-a-phone, every-page-has-a-mobile-story),
// at the 390px it was accepted at: the page names itself; the eight tabs on one row that slides; a block per transfer —
// whose goods and who opened them, where it goes, the next act named at its foot — no values; the growing pager,
// centred, no page size; and nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const block = canvas.getByTestId("transfer-row-601");

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("transfers-table")).toHaveAttribute("data-layout", "phone");
    await expect(canvasElement.querySelector("table")).toBeNull();
    await expect(canvas.getByRole("heading", { name: "Transfers" })).toBeVisible();
    await tabsDoNotOverlap(canvasElement);

    await waitFor(() => expect(within(block).getByTestId("transfer-owner-601")).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(within(block).getByTestId("transfer-created-by-601")).toHaveTextContent("by Ani Rahayu"));
    await waitFor(() => expect(within(block).getByTestId("transfer-other-601")).toHaveTextContent(/^To Gudang Cabang$/));
    await expect(within(block).getByTestId("transfer-action-process-601")).toBeVisible();
    await expect(canvas.queryByText(/Rp\s/)).toBeNull();
    await fitsTheScreen(canvasElement);

    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await expect(canvas.queryByTestId("transfer-pager-size")).toBeNull();
  },
};
