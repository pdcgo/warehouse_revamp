import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { PROBLEM_ROWS } from "../../fixtures";
import { RetiredProblemPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/ProblemItemsRetired",
  component: RetiredProblemPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: PROBLEM_ROWS },
} satisfies Meta<typeof RetiredProblemPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("retired-note")).toHaveTextContent("Retired");
  },
};

// ⚠ THE DEAD END IS THE POINT OF KEEPING IT. Everything on the screen is a total. There is no row to
// click, no item named and no decision to record — so a reader who concludes "damage is up" has
// nowhere to go. Both successors start from a row for exactly this reason.
export const NothingHereCanBeActedOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // No table, no rows, no actions.
    await expect(canvas.queryByRole("table")).toBeNull();
    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
    await expect(canvas.getByTestId("dead-end")).toBeVisible();
  },
};

// It reports totals well enough — that was never the problem with it.
export const TheReportingItselfIsFine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const summary = within(canvas.getByTestId("summary"));
    await expect(summary.getByText("Units affected")).toBeVisible();
    await expect(canvas.getAllByTestId("chart")).toHaveLength(2);
  },
};

// Single series, grouped rather than stacked — the question is "how do these compare", and every bar
// has to start from the same baseline for that to be readable.
export const OneSeriesPerChart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // One series needs no legend box — the chart's own title names it.
    await expect(canvas.queryAllByTestId("chart-legend")).toHaveLength(0);
  },
};

export const NothingReported: Story = {
  args: { rows: [], weekly: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("retired-problem-page")).toHaveTextContent("No history");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
