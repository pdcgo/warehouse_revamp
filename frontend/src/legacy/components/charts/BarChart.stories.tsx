import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within, screen } from "storybook/test";

import { BarChart, description } from "./BarChart";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const meta = {
  title: "Legacy/Components/Charts/BarChart",
  component: BarChart,
  parameters: { docs: { description: { component: description } } },
  args: {
    labels: LABELS,
    series: [{ name: "Orders packed", values: [42, 55, 38, 61, 74, 29] }],
  },
} satisfies Meta<typeof BarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

// ONE series gets NO legend — the chart's own title names it, and a legend box repeating that name
// is furniture.
export const SingleSeriesHasNoLegend: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("chart")).toBeVisible();
    await expect(canvas.queryByTestId("chart-legend")).toBeNull();
  },
};

// TWO OR MORE series always get a legend. Colour alone is not an identification — a reader with a
// colour-vision deficiency, a greyscale print or forced-colours mode has nothing without it.
export const MultipleSeriesAlwaysGetALegend: Story = {
  args: {
    series: [
      { name: "Packed", values: [42, 55, 38, 61, 74, 29] },
      { name: "Returned", values: [4, 7, 3, 9, 6, 2] },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("chart-legend")).toHaveTextContent("Packed");
    await expect(canvas.getByTestId("chart-legend")).toHaveTextContent("Returned");
  },
};

// Every column names itself and its values on hover. The hit target is the whole COLUMN, not the
// bar — hovering a 6px bar is a precision task nobody should be asked to perform.
export const HoverNamesTheColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.hover(canvas.getByTestId("bar-hit-3"));

    await waitFor(async () => {
      await expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("Thu");
    });
  },
};

// Stacked answers "what does the TOTAL consist of"; grouped answers "how do these compare at each
// point". The axis reaches the stack total, not the tallest single series.
export const Stacked: Story = {
  args: {
    stacked: true,
    series: [
      { name: "Shopee", values: [20, 26, 18, 30, 34, 12] },
      { name: "Tokopedia", values: [14, 18, 12, 21, 25, 11] },
      { name: "TikTok", values: [8, 11, 8, 10, 15, 6] },
    ],
  },
};

export const Empty: Story = { args: { labels: [], series: [] } };

export const Loading: Story = { args: { loading: true } };
