import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the notes, one per writer: the selling team's read, this warehouse's written here.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Notes",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSE WRITES ITS OWN NOTE (owner: *"bisa mengubah catatan warehouse"*, the-warehouse-writes-its-own-note) — its
// Ubah opens the edit, as the selling note's does; the selling team's note above it has none. Nothing stores it yet: the
// page's sixth mark, and a save says it was not kept, the block empty again.
export const TheWarehouseWritesItsOwnNote: Story = {
  name: "Warehouse's note, written",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");
    const own = within(section).getByTestId("restock-detail-note-warehouse");

    await expect(within(section).queryByTestId("restock-notes-edit")).toBeNull();
    await expect(within(own).getByTestId("not-implemented-warehouseNoteKept")).toHaveTextContent("6");

    await userEvent.click(within(own).getByTestId("restock-warehouse-note-edit"));
    const input = await within(own).findByTestId("restock-warehouse-note-input");
    await expect(input).toHaveFocus();
    await userEvent.type(input, "Dus penyok di sudut", { delay: 20 });
    await userEvent.click(within(own).getByTestId("restock-warehouse-note-save"));

    await expect(await screen.findByText("The warehouse's note was not kept — nothing stores it yet.")).toBeInTheDocument();
    await waitFor(() => expect(within(own).queryByTestId("restock-warehouse-note-input")).toBeNull());
    await expect(within(own).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("No note from the warehouse yet.");
  },
};
