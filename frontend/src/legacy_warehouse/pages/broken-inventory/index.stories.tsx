import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { PROBLEM_ROWS, type ProblemRow } from "../../fixtures";
import { BrokenInventoryPage, description } from "./index";

// A second damage report against the same product, so the screen has a genuine repeat to surface.
// Without one, a by-subject grouping and a flat list look identical — which is exactly the criticism
// this screen exists to answer.
const WITH_A_REPEAT: ProblemRow[] = [
  ...PROBLEM_ROWS,
  {
    id: 505,
    sku: "AGK-SEPATU-40",
    product: "Sepatu lari — 40",
    team: "Toko Anggrek",
    kind: "damaged",
    units: 2,
    note: "Box crushed again — same supplier pallet",
    reportedBy: "Budi Santoso",
    reportedAt: Math.floor(Date.now() / 1000) - 2 * 86_400,
    resolved: false,
  },
];

const meta = {
  title: "LegacyWarehouse/Pages/ProblemItemsBySubject",
  component: BrokenInventoryPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: WITH_A_REPEAT },
} satisfies Meta<typeof BrokenInventoryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("broken-table")).toBeVisible();
  },
};

// ⚠ THE REGROUPING IS THE WHOLE FEATURE. Two separate damage reports against one product read as two
// unrelated incidents in a flat list; here they share a row and read as a pattern.
export const ARepeatBecomesVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("Sepatu lari — 40").closest("tr")!;
    await expect(within(row).getByText("2")).toBeVisible();

    // And it sorts to the top — a pattern is a repeat, so the most-repeated row is the one to read.
    await expect(canvas.getAllByRole("row")[1]).toHaveTextContent("Sepatu lari");
  },
};

// One incident is bad luck; the same subject twice is a process problem. That count is the headline
// and it is the only thing here a flat list cannot say.
export const RepeatOffendersAreTheHeadline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const summary = within(canvas.getByTestId("summary"));
    await expect(summary.getByText("Repeat offenders")).toBeVisible();
  },
};

// ⚠ THE GROUPING IS THE USER'S CHOICE. "Which product keeps breaking" and "which team keeps
// reporting" are different investigations; fixing one at design time is how the original ended up
// with three near-identical tables.
export const TheGroupingIsAChoiceNotADecision: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole("columnheader")[0]).toHaveTextContent("Product");

    await userEvent.click(canvas.getByRole("button", { name: /by team/i }));
    await expect(canvas.getAllByRole("columnheader")[0]).toHaveTextContent("Team");

    // Toko Anggrek now carries both of its incidents on one row.
    const row = canvas.getByText("Toko Anggrek").closest("tr")!;
    await expect(within(row).getByText("2")).toBeVisible();
  },
};

export const ByProblemKind: Story = {
  args: { grouping: "kind" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole("columnheader")[0]).toHaveTextContent("Problem");
    await expect(canvas.getAllByRole("row")[1]).toHaveTextContent("damaged");
  },
};

// The oldest thing in the group, not the newest — the group is only closed when its last row is.
export const TheOldestOpenItemLeadsTheGroup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("Sepatu lari — 40").closest("tr")!;
    // Reports at 9 and 2 days old; the group shows the 9.
    await expect(within(row).getByText("9d")).toBeVisible();
  },
};

export const NothingOutstanding: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("broken-table")).toHaveTextContent("Nothing outstanding");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
