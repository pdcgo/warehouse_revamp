import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { BillingPayableLogPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/Payable/Log",
  component: BillingPayableLogPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: LEDGER_ENTRIES },
} satisfies Meta<typeof BillingPayableLogPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("billing-log-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// ⚠ DEBIT AND CREDIT STAY SEPARATE. A ledger entry IS one or the other — collapsing them into one
// signed number loses which side it was written on, and that is the thing being checked when a
// figure is disputed.
export const DebitAndCreditAreSeparateColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Debit")).toBeVisible();
    await expect(canvas.getByText("Credit")).toBeVisible();
  },
};

export const Loading: Story = { args: { entries: [], loading: true } };

export const Empty: Story = { args: { entries: [] } };
