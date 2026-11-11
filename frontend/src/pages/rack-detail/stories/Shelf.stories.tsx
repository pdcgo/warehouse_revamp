import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { At43, RACK_DETAIL_META } from "./kit";

// RACK DETAIL — the shelf, Produk, when there is nothing on it. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Shelf",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// AN EMPTY RACK SAYS SO, AND WHAT FILLS IT (an-empty-list-shows-a-hint) — B-02-1 holds nothing and has no history: Produk
// says it, and so does Riwayat.
export const AnEmptyRack: Story = {
  name: "An empty rack",
  render: () => <At43 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("rack-detail-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("moved to it from another");
    await expect(canvas.getByTestId("rack-summary-last-counted")).toHaveTextContent("Never counted");
    await expect(await canvas.findByTestId("rack-history-empty")).toBeVisible();
  },
};
