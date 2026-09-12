import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { METRICS } from "../../fixtures";
import { StatisticProductCrossPage, description } from "./index";

const PAIRS = METRICS.map((m, i) => ({
  ...m,
  label: `${m.label} + ${METRICS[(i + 1) % METRICS.length].label}`,
  sublabel: undefined,
}));

const meta = {
  title: "Legacy/Pages/Statistics/ProductCross",
  component: StatisticProductCrossPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: PAIRS },
} satisfies Meta<typeof StatisticProductCrossPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ NO CHART, and no toggle to reach one. The rows are PAIRS, not periods — a time series would
// imply a progression from one pair to the next that does not exist.
export const HasNoChart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("metric-screen")).toHaveAttribute("data-dimension", "Product pair");
    await expect(canvas.queryByTestId("metric-chart")).toBeNull();
    // Not even the toggle — offering a view that should not exist is worse than not offering it.
    await expect(canvas.queryByTestId("segmented-radio")).toBeNull();
  },
};

// It still shares everything that does NOT change with the dimension — the measures, the derived
// margin, the export.
export const SharesTheMeasuresAndTheMarginRule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("th-margin")).toBeVisible();
    await expect(canvas.getByTestId("metric-export")).toBeVisible();
  },
};

export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toBeVisible();
  },
};
