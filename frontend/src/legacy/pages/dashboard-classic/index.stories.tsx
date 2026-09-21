import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { DashboardClassicPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Dashboard/DashboardClassic",
  component: DashboardClassicPage,
  parameters: { docs: { description: { component: description } } },
  args: { orders: 513, units: 956, revenue: 142_000_000n, cost: 96_400_000n },
} satisfies Meta<typeof DashboardClassicPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// It only REPORTS. No charts, no activity, no warnings, and nothing to click — which is exactly the
// point of keeping it beside the other two generations.
export const ReportsOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("summary")).toBeVisible();
    await expect(canvas.queryByTestId("alert")).toBeNull();
    await expect(canvas.queryByTestId("chart")).toBeNull();
    await expect(canvas.queryByRole("table")).toBeNull();
  },
};

export const Loading: Story = { args: { loading: true } };
