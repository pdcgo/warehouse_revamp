import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { At502, WAREHOUSE_DETAIL_META, loaded, trailRows } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the trail, the selling team's edits in it.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Timeline",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The selling team's edit is in the warehouse's trail too — the count it is about to accept was changed after the box
// was opened (edits-are-in-the-same-trail).
export const TheTrailShowsTheSellingTeamsEdit: Story = {
  name: "The selling team's edit",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]));
    await expect(trailRows(canvasElement)[2]).toHaveTextContent("10 → 12");
  },
};
