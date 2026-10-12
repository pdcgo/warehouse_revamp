import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { TransferTimeline } from "./TransferTimeline";
import { storyTransfer } from "./storyTransfer";

// THE TRAIL (every-transfer-status-change-is-logged): one row per status change, by whoever made it — the selling
// team, Warehouse A or Warehouse B — and the step still to come while there is one.
const meta = {
  title: "Features/WarehouseTransfer/TransferTimeline",
  component: TransferTimeline,
  parameters: { signedIn: true },
  args: { transfer: storyTransfer(603n) },
} satisfies Meta<typeof TransferTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

// Shipped: three rows, the courier on the ship row, and "on its way" still to come.
export const Shipped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-timeline-3")).toHaveAttribute("data-kind", "status");
    await expect(canvas.getByTestId("transfer-timeline-3-description")).toHaveTextContent("JNE7788990011");
    await expect(canvas.getByTestId("transfer-timeline-awaiting")).toBeInTheDocument();
    // People are named, not numbered, once the lookup lands.
    await waitFor(() => expect(canvas.getByTestId("transfer-timeline-3-by")).toHaveTextContent("Budi"));
  },
};

// Lost: the reason the team gave is on its row, and nothing is awaited — the box may turn up, but nobody waits on it.
export const Lost: Story = {
  args: { transfer: storyTransfer(607n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-timeline-4-description")).toHaveTextContent(/melacak/);
    await expect(canvas.queryByTestId("transfer-timeline-awaiting")).toBeNull();
  },
};

export const Accepted: Story = { args: { transfer: storyTransfer(605n) } };
