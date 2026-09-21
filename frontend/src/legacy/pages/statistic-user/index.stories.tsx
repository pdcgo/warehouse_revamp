import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { METRICS } from "../../fixtures";
import { StatisticUserPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Statistics/User",
  component: StatisticUserPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: METRICS },
} satisfies Meta<typeof StatisticUserPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// It opens on the CHART: the first question of a performance screen is which way things are
// moving, not which row to act on.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("metric-screen")).toHaveAttribute("data-dimension", "User");
    await expect(canvas.getByTestId("metric-chart")).toBeVisible();
  },
};

// Chart and table are a TOGGLE, not both at once — they answer different questions, and showing
// both halves each.
export const TableView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-table"));

    await waitFor(async () => {
      await expect(canvas.queryByTestId("metric-chart")).toBeNull();
    });
    // Margin is DERIVED in the shared screen, so every dimension reports it the same way.
    // Queried by its column header test id — the Summary band above also has a "Margin" tile, so a
    // bare text query would match twice.
    await expect(canvas.getByTestId("th-margin")).toBeVisible();
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };

export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-table"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("empty-hint")).toBeVisible();
    });
  },
};
