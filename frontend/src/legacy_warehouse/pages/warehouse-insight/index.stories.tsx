import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { DAILY_TRAFFIC, TEAM_THROUGHPUT } from "../../fixtures";
import { InsightPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/WarehouseInsight",
  component: InsightPage,
  parameters: { docs: { description: { component: description } } },
  args: { teams: TEAM_THROUGHPUT, daily: DAILY_TRAFFIC },
} satisfies Meta<typeof InsightPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-table")).toBeVisible();
  },
};

// ⚠ THE SORT ORDER IS THE ARGUMENT. Sorted by volume, Toko Melati (1,204 shipped, 6 damaged) leads
// and Toko Anggrek (41 shipped, 58 damaged) is last — below the fold, where nobody scrolls. Sorted
// by RATIO, the row worth a phone call is first.
export const SortedByRatioNotVolume: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const firstRow = canvas.getAllByRole("row")[1];
    await expect(firstRow).toHaveTextContent("Toko Anggrek");

    // The biggest team by volume is NOT first.
    await expect(firstRow).not.toHaveTextContent("Toko Melati");
  },
};

// A rate above 5% is called out. The number is meaningless on its own — 58 damaged units is either
// catastrophic or routine depending on what was shipped — so the ratio is what gets the weight.
export const TheRateIsWhatIsMarkedNotTheCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const rates = canvas.getAllByTestId("damage-rate");
    await expect(rates[0]).toHaveTextContent("141.5%");
    await expect(rates[0]).toHaveStyle({ fontWeight: "600" });
    // A healthy team's rate is present but unweighted.
    await expect(rates[2]).not.toHaveStyle({ fontWeight: "600" });
  },
};

// The reason for the ordering is stated on the screen, so a reader who expected volume order knows
// the table is not broken.
export const TheOrderingIsExplained: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("insight-page")).toHaveTextContent("Not sorted by volume");
  },
};

// ⚠ GROUPED, NOT STACKED. Inbound and outbound are two flows in opposite directions, not parts of
// one quantity — stacking them produces a total that means nothing.
export const MovementIsGroupedNotStacked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Two series, so a legend is present — identity is never carried by colour alone.
    const charts = canvas.getAllByTestId("chart");
    await expect(charts).toHaveLength(2);
    await expect(within(charts[0]).getByText("Received")).toBeVisible();
    await expect(within(charts[0]).getByText("Shipped")).toBeVisible();
  },
};

export const NoData: Story = {
  args: { teams: [], daily: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-table")).toHaveTextContent("No throughput recorded");
  },
};

export const Loading: Story = { args: { teams: [], daily: [], loading: true } };
