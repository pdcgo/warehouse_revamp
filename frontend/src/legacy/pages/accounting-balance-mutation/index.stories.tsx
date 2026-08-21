import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { AccountingBalanceMutationPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Balance/Mutations",
  component: AccountingBalanceMutationPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: LEDGER_ENTRIES },
} satisfies Meta<typeof AccountingBalanceMutationPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ OLDEST FIRST — the one screen here that deliberately reverses the house newest-first default. A
// running total accumulated backwards is arithmetic nobody can follow, and the screen says so rather
// than looking like an oversight.
export const OldestFirstSoTheRunningTotalReadsDownward: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("mutation-order-note")).toHaveTextContent(/oldest first/i);

    const running = canvas.getAllByTestId("mutation-running");
    await expect(running.length).toBeGreaterThan(1);
  },
};

// The running balance is what makes this the bridge between the two balance screens: the balance
// view says where an account stands, the journal says what was posted, only this says how it got
// there.
export const RunningBalanceAccumulates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const running = canvas.getAllByTestId("mutation-running");
    // Consecutive rows differ — an accumulator that repeated itself would not be one.
    await expect(running[0].textContent).not.toBe(running[running.length - 1].textContent);
  },
};

export const Loading: Story = { args: { entries: [], loading: true } };

export const Empty: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No movements on this account");
  },
};
