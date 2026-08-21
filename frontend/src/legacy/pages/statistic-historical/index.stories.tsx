import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { METRIC_SPINE } from "../../fixtures";
import { StatisticHistoricalPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Statistics/Historical",
  component: StatisticHistoricalPage,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof StatisticHistoricalPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// It has NO table — it asks how the whole business moved, not what the period breaks down into, and
// giving it rows would be inventing a breakdown the screen is not about.
export const NoBreakdownTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic-historical-page")).toBeVisible();
    await expect(canvas.queryByRole("table")).toBeNull();
  },
};

// The GRAIN control is the point: the same series read daily, monthly and yearly answers three
// different questions, and a screen fixed to one picks for the reader.
export const GrainIsTheReadersChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("period-grain-day")).toBeVisible();
    await expect(canvas.getByTestId("period-grain-month")).toBeVisible();
    await expect(canvas.getByTestId("period-grain-year")).toBeVisible();
  },
};

// Trend versus compare: both are legitimate readings of ONE series, which is why it is a toggle.
export const CompareSwitchesToBars: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-bar"));

    await waitFor(async () => {
      // The bar chart's hit columns appear; the line chart's do not.
      await expect(canvas.getByTestId("bar-hit-0")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("line-hit-0")).toBeNull();
  },
};

// A gap in the series BREAKS the line rather than being drawn through — an invented segment on a
// revenue chart is indistinguishable from a real flat period.
export const GapsAreNotDrawnThrough: Story = {
  args: {
    labels: METRIC_SPINE,
    series: [{ name: "Revenue", values: [18_400, 21_200, null, null, 27_100, 23_400, 29_800, 31_200] }],
  },
  play: async ({ canvasElement }) => {
    // Scoped to the CHART. A bare `querySelector("path")` finds the first lucide icon on the page
    // (the export button's) long before it reaches the series line.
    const path = canvasElement.querySelector('[data-testid="chart"] svg path');

    // Two "M" commands = two separate strokes, i.e. the line genuinely broke rather than joining
    // across the gap.
    await expect((path?.getAttribute("d")?.match(/M/g) ?? []).length).toBe(2);
  },
};

export const Loading: Story = { args: { loading: true } };
