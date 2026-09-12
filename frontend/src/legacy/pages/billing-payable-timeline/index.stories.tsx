import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { BillingPayableTimelinePage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/Payable/Timeline",
  component: BillingPayableTimelinePage,
  parameters: { docs: { description: { component: description } } },
  args: { counterparty: "CV Sinar Jaya", entries: LEDGER_ENTRIES },
} satisfies Meta<typeof BillingPayableTimelinePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("billing-timeline-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// THE running balance is the whole point — each row says what the balance BECAME, so a disputed
// figure can be traced to the movement that produced it. A log lists movements; only this
// accumulates them.
export const EachRowSaysWhatTheBalanceBecame: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const running = canvas.getAllByTestId("running-balance");
    await expect(running).toHaveLength(LEDGER_ENTRIES.length);
    // Consecutive rows differ — an accumulator that repeated the same figure would not be one.
    await expect(running[0].textContent).not.toBe(running[1].textContent);
  },
};

export const NoMovementsYet: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("billing-timeline")).toHaveTextContent(/no movements/i);
  },
};
