import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { EXPENSES } from "../../financeFixtures";
import { AccountingExpenseOverviewPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Expense/Overview",
  component: AccountingExpenseOverviewPage,
  parameters: { docs: { description: { component: description } } },
  args: { expenses: EXPENSES },
} satisfies Meta<typeof AccountingExpenseOverviewPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// SHARE OF TOTAL is what makes the screen useful. An amount says what rent cost; a share says rent
// is most of everything, which is the fact that changes a decision.
export const ShareOfTotalIsTheUsefulColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Share")).toBeVisible();
    // Every category row carries one — the share column is the whole reason for the roll-up.
    await expect(canvas.getAllByText(/%$/).length).toBeGreaterThan(0);
  },
};

// Largest first — the biggest line is the one worth questioning, and alphabetical order buries it
// among the small ones.
export const LargestCategoryLeads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Rent (18jt) dominates the fixture, so it heads both the table and the summary.
    await expect(canvas.getByTestId("summary")).toHaveTextContent("Rent");
  },
};

export const Loading: Story = { args: { expenses: [], loading: true } };

export const Empty: Story = {
  args: { expenses: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("Nothing spent in this period");
  },
};
