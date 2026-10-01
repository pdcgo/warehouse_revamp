import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { DAY_TOTALS, INVOICES } from "../../financeFixtures";
import { InvoiceOverviewPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Invoices/Overview",
  component: InvoiceOverviewPage,
  parameters: { docs: { description: { component: description } } },
  args: { invoices: INVOICES, days: DAY_TOTALS },
} satisfies Meta<typeof InvoiceOverviewPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE reason the screen exists: the NET position, which neither the payable nor the receivable list
// can show. Reading it off two screens means holding one number in your head while you navigate.
export const ShowsTheNetPosition: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Net position")).toBeVisible();
    await expect(canvas.getAllByTestId("statistic")).toHaveLength(3);
  },
};

// Overdue in BOTH directions, in one table — being chased and needing to chase are the same
// urgency, and splitting them across two screens hides half of it.
export const OverdueSpansBothDirections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // "We owe" appears both as a tile title and in the direction column, so this asserts on the
    // COUNT rather than a unique match — the point being that payable rows reach this table at all.
    await expect(canvas.getAllByText("We owe").length).toBeGreaterThan(1);
  },
};

// Nothing overdue is GOOD news, and the copy says so rather than reading as a failure to load.
export const NothingOverdue: Story = {
  args: { invoices: INVOICES.filter((i) => i.status !== "overdue") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("Nothing overdue");
  },
};

export const Loading: Story = { args: { invoices: [], days: [], loading: true } };
