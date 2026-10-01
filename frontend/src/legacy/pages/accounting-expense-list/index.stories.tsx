import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { EXPENSES } from "../../financeFixtures";
import { AccountingExpenseListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Expense/List",
  component: AccountingExpenseListPage,
  parameters: { docs: { description: { component: description } } },
  args: { expenses: EXPENSES },
} satisfies Meta<typeof AccountingExpenseListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// WHO PAID is a COLUMN. Most of these are out of somebody's own pocket and reimbursed later, so
// "who is owed this back" is part of what the expense is — burying it in a detail panel means
// opening every row to work out the month's reimbursements.
export const WhoPaidIsAColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Paid by")).toBeVisible();
    await expect(canvas.getAllByText("Budi Hartono").length).toBeGreaterThan(0);
  },
};

export const FilteredByCategory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(canvas.getByLabelText("Category"), "Rent");

    await waitFor(async () => {
      await expect(canvas.queryByText("Courier top-up")).toBeNull();
    });
    await expect(canvas.getByText("Gudang Utara — August")).toBeVisible();
  },
};

// The total is over EVERY expense, not the filtered set — "what did we spend this month" must not
// change because somebody narrowed to one category.
export const TotalIgnoresTheFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const before = canvas.getByTestId("summary").textContent;

    await userEvent.selectOptions(canvas.getByLabelText("Category"), "Rent");
    await waitFor(async () => {
      await expect(canvas.queryByText("Courier top-up")).toBeNull();
    });

    await expect(canvas.getByTestId("summary").textContent).toBe(before);
  },
};

export const Loading: Story = { args: { expenses: [], loading: true } };

export const Empty: Story = { args: { expenses: [] } };
