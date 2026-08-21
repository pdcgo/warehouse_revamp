import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TRIAL_BALANCE } from "../../financeFixtures";
import { AccountingTrialBalancePage, description } from "./index";

// The fixture is deliberately OUT — the interesting state of a trial balance is the one that does
// not balance, and a story set only shows it if the data can be wrong.
const BALANCED = [
  ...TRIAL_BALANCE.filter((a) => a.code !== "5000"),
  // Debits: 128.4 + 36.5 + 214 = 378.9. Credits: 49.95 + 200 + 186.3 = 436.25. The balancing
  // expense figure closes the gap exactly.
  { code: "5000", name: "Cost of goods sold", kind: "expense" as const, debit: 57_350_000n, credit: 0n },
];

const meta = {
  title: "Legacy/Pages/Accounting/Ledger/TrialBalance",
  component: AccountingTrialBalancePage,
  parameters: { docs: { description: { component: description } } },
  args: { accounts: BALANCED },
} satisfies Meta<typeof AccountingTrialBalancePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Balanced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("trial-balance-page")).toHaveAttribute("data-balanced", "true");
    await expect(canvas.getByTestId("trial-verdict")).toHaveTextContent("The books balance");
  },
};

// ⚠ THE WHOLE JOB OF THE SCREEN. If the two sides disagree, nothing on any accounting screen can be
// trusted — so the verdict is at the TOP, not only summed in a footer a hundred accounts below.
export const UnbalancedSaysSoAtTheTop: Story = {
  args: {
    accounts: [
      ...BALANCED.filter((a) => a.code !== "5000"),
      { code: "5000", name: "Cost of goods sold", kind: "expense", debit: 57_110_000n, credit: 0n },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("trial-balance-page")).toHaveAttribute("data-balanced", "false");

    const verdict = canvas.getByTestId("trial-verdict");
    await expect(verdict).toHaveTextContent("do not balance");
    // The DIFFERENCE is stated — a searchable amount, where "not balanced" leaves the reader to do
    // the arithmetic before they can act.
    await expect(verdict).toHaveTextContent("240.000");
  },
};

// Both sides are also totalled at the bottom, where a trial balance is conventionally read.
export const TotalsAtTheBottomToo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("trial-totals")).toHaveTextContent("Total debits");
    await expect(canvas.getByTestId("trial-totals")).toHaveTextContent("Total credits");
  },
};

export const Loading: Story = { args: { accounts: [], loading: true } };
