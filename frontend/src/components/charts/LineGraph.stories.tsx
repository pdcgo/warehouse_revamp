import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { formatRupiahCompact, formatRupiahNumber } from "../../lib/money";
import { LineGraph, description } from "./LineGraph";

const WEEK = ["1 Okt", "2 Okt", "3 Okt", "4 Okt", "5 Okt", "6 Okt", "7 Okt"];

const rupiah = (v: number) => formatRupiahNumber(v);
const rupiahShort = (v: number) => formatRupiahCompact(BigInt(Math.round(v)));
const count = (v: number) => v.toLocaleString("id-ID");

const meta = {
  title: "Components/Charts/LineGraph",
  component: LineGraph,
  parameters: { docs: { description: { component: description } } },
  args: {
    title: "Amounts (Rp)",
    labels: WEEK,
    lines: [
      { label: "Order total", values: [4_200_000, 5_100_000, 3_900_000, 6_400_000, 7_200_000, 5_800_000, 8_100_000] },
      { label: "Settlement amount", values: [3_100_000, 3_800_000, 3_000_000, 4_900_000, 5_500_000, 4_200_000, 6_300_000] },
    ],
    formatValue: rupiah,
    formatTick: rupiahShort,
    testId: "graph",
  },
} satisfies Meta<typeof LineGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * An axis's tick labels, in order. ⚠ Recharts 3 draws them in their own layer, `recharts-<axis>Axis-tick-labels`, NOT
 * inside the axis's group, so `.recharts-xAxis .recharts-cartesian-axis-tick-value` finds nothing.
 */
const ticks = (el: Element, axis: "x" | "y") =>
  [...el.querySelectorAll(`.recharts-${axis}Axis-tick-labels .recharts-cartesian-axis-tick-value`)].map((t) => t.textContent ?? "");

/**
 * The graph draws after it has measured its box, and its axes a render later (the side axis sizes itself to its
 * labels), so a test waits for the lines and both axes' ticks first.
 */
async function drawn(canvasElement: HTMLElement, lines: number) {
  await waitFor(
    () => {
      expect(canvasElement.querySelectorAll(".recharts-line-curve")).toHaveLength(lines);
      expect(ticks(canvasElement, "x").length).toBeGreaterThan(0);
      expect(ticks(canvasElement, "y").length).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );

  return within(canvasElement);
}

// TWO MONEY LINES over a week — one graph per kind of number, so two amounts share an axis and can be compared. The side
// axis is short (Rp 8jt) so the magnitude reads first.
export const TwoLines: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement, 2);

    await expect(canvas.getByRole("heading", { name: "Amounts (Rp)" })).toBeVisible();
    // Each line is named in the legend.
    await expect(canvas.getByText("Order total")).toBeVisible();
    await expect(canvas.getByText("Settlement amount")).toBeVisible();
    // The points along the bottom, in the order given, both ends always shown.
    const x = ticks(canvasElement, "x");
    await expect(x[0]).toBe("1 Okt");
    await expect(x[x.length - 1]).toBe("7 Okt");
    // The side axis uses the short form, never the full amount.
    await expect(ticks(canvasElement, "y").some((v) => v.endsWith("jt"))).toBe(true);
  },
};

// ONE COUNT LINE — no `formatTick`, so the side axis formats like the tooltip.
export const OneLine: Story = {
  args: {
    title: "Counts",
    lines: [{ label: "Order count", values: [42, 51, 39, 64, 72, 58, 81] }],
    formatValue: count,
    formatTick: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement, 1);

    await expect(canvas.getByText("Order count")).toBeVisible();
  },
};

// SIX LINES — every colour in turn, each a categorical hue. A seventh would take the first colour again, which is part of
// why the cap on lines per graph is still to be decided (the-chart-waits-for-a-chart-component).
export const SixLines: Story = {
  args: {
    title: "Amounts (Rp)",
    lines: ["Order total", "Settlement amount", "Profit", "Ads spend", "Expenses", "Stock lost"].map((label, j) => ({
      label,
      values: WEEK.map((_, i) => 1_000_000 * (j + 1) + 400_000 * ((i * (j + 2)) % 5)),
    })),
  },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement, 6);
  },
};

// A MONTH OF DAYS — past 31 points the dots go and the line carries the reading.
export const ManyPoints: Story = {
  args: {
    title: "Counts",
    labels: Array.from({ length: 60 }, (_, i) => `${i + 1}`),
    lines: [{ label: "Order count", values: Array.from({ length: 60 }, (_, i) => 40 + ((i * 7) % 23)) }],
    formatValue: count,
    formatTick: undefined,
  },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement, 1);
    await expect(canvasElement.querySelectorAll(".recharts-line-dots circle")).toHaveLength(0);
  },
};
