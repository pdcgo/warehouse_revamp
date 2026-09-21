import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { DashboardV1Page, description } from "./index";

const meta = {
  title: "Legacy/Pages/Dashboard/DashboardV1",
  component: DashboardV1Page,
  parameters: { docs: { description: { component: description } } },
  args: { waitingOrders: 42, lowStock: 7, revenue: 142_000_000n, recent: ORDERS },
} satisfies Meta<typeof DashboardV1Page>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ The instructive difference from the current dashboard: NO warnings block. "7 low stock" reads
// the same whether that is normal or a crisis, so anything wrong had to be inferred from a number
// being high.
export const NoWarningsAnywhere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("dashboard-v1-page")).toBeVisible();
    await expect(canvas.queryByTestId("alert")).toBeNull();
    // The tiles are the first thing on the screen.
    await expect(canvas.getAllByTestId("statistic")).toHaveLength(4);
  },
};

// It also has no charts and no link out — the table IS the recent list, at full length.
export const TableIsNotTruncated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText(/^ORD-/)).toHaveLength(ORDERS.length);
  },
};

export const Loading: Story = { args: { loading: true, recent: [] } };
