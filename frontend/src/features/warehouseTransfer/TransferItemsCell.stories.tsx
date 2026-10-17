import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TransferItemsCell } from "./TransferItemsCell";
import { storyTransfer } from "./storyTransfer";

// A list row's "what is in the box": products and pieces first, the first SKU under it, the rest behind a popover.
const meta = {
  title: "Features/WarehouseTransfer/TransferItemsCell",
  component: TransferItemsCell,
  args: { items: storyTransfer(601n).items },
} satisfies Meta<typeof TransferItemsCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoProducts: Story = {
  play: async ({ canvasElement }) => {
    // 10 Beras + 6 Kopi.
    await expect(within(canvasElement).getByText(/2 products · 16 pcs/)).toBeInTheDocument();
  },
};

export const OneProduct: Story = { args: { items: storyTransfer(602n).items } };

// The warehouse crew counts boxes; another team's values are not theirs to read.
export const WithoutPrices: Story = { args: { showPrices: false } };
