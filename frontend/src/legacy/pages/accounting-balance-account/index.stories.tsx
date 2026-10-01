import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TRIAL_BALANCE } from "../../financeFixtures";
import { AccountingBalanceAccountPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Balance/Accounts",
  component: AccountingBalanceAccountPage,
  parameters: { docs: { description: { component: description } } },
  args: { accounts: TRIAL_BALANCE },
} satisfies Meta<typeof AccountingBalanceAccountPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ NET BALANCES, not debit and credit columns. That is the difference from the trial balance:
// somebody asking "how much cash do we have" wants one number per account, not two to subtract.
export const ShowsNetBalancesNotColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Balance")).toBeVisible();
    await expect(canvas.queryByText("Debit")).toBeNull();
    await expect(canvas.queryByText("Credit")).toBeNull();
  },
};

// The sign convention is APPLIED, not shown — a liability reads as a positive amount of liability.
// Showing it negative would require accounting training to read the screen.
export const EveryFigureReadsPositive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByText(/^-Rp/)).toBeNull();
  },
};

// Assets = liabilities + equity. When it does not hold, the balance sheet is not one — and the
// screen says so instead of presenting figures that cannot all be true.
export const DoesNotBalanceIsCalledOut: Story = {
  args: {
    accounts: [
      ...TRIAL_BALANCE.filter((a) => a.code !== "3000"),
      { code: "3000", name: "Owner equity", kind: "equity", debit: 0n, credit: 150_000_000n },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("balance-account-page")).toHaveAttribute("data-balances", "false");
    await expect(canvas.getByTestId("balance-warning")).toBeVisible();
  },
};

export const Loading: Story = { args: { accounts: [], loading: true } };
