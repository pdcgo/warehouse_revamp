import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LineChart, description } from "./LineChart";

const LABELS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"];

const meta = {
  title: "Legacy/Components/Charts/LineChart",
  component: LineChart,
  parameters: { docs: { description: { component: description } } },
  args: {
    labels: LABELS,
    series: [{ name: "Stock on hand", values: [820, 910, 870, 1040, 1120, 980, 1210, 1180] }],
  },
} satisfies Meta<typeof LineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSeries: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("chart")).toBeVisible();
    await expect(canvas.queryByTestId("chart-legend")).toBeNull();
  },
};

// ⚠ THE GAP RULE. A null is "we have no reading for this week" — a scanner offline, a shop that did
// not exist yet. Joining across it would draw a straight segment the data never claimed, and on a
// stock chart that invented line is indistinguishable from a real flat period. So the line BREAKS,
// and the tooltip reports the gap as a gap rather than as zero.
export const GapsBreakTheLine: Story = {
  args: {
    series: [{ name: "Stock on hand", values: [820, 910, null, null, 1120, 980, 1210, 1180] }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const path = canvasElement.querySelector("path");
    // Two "M" commands = two separate strokes, i.e. the line was genuinely broken rather than joined.
    await expect((path?.getAttribute("d")?.match(/M/g) ?? []).length).toBe(2);

    await userEvent.hover(canvas.getByTestId("line-hit-2"));
    await waitFor(async () => {
      await expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("—");
    });
  },
};

// The crosshair reads EVERY series at the hovered point at once — which is the question a
// multi-series line chart is actually asked ("what was happening that week?").
export const CrosshairReadsEverySeries: Story = {
  args: {
    series: [
      { name: "Inbound", values: [820, 910, 870, 1040, 1120, 980, 1210, 1180] },
      { name: "Outbound", values: [640, 700, 810, 760, 990, 1010, 940, 1100] },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.hover(canvas.getByTestId("line-hit-4"));

    await waitFor(async () => {
      const tip = screen.getByTestId("chart-tooltip");
      expect(tip).toHaveTextContent("Inbound");
      expect(tip).toHaveTextContent("Outbound");
    });
  },
};

// A zoomed axis is legitimate for a LINE (which encodes change by slope) and never for a bar (which
// encodes magnitude by length). Use it when the question is "which way is it moving".
export const ZoomedAxis: Story = { args: { zoomAxis: true } };

export const Empty: Story = { args: { labels: [], series: [] } };
