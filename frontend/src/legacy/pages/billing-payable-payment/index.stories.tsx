import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { PAYMENTS } from "../../financeFixtures";
import { BillingPayablePaymentPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/Payable/Payment",
  component: BillingPayablePaymentPage,
  parameters: { docs: { description: { component: description } } },
  args: { payments: PAYMENTS },
} satisfies Meta<typeof BillingPayablePaymentPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("billing-payment-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// Confirmed and unconfirmed are SEPARATED, not mixed. A statement match is what turns a claim into
// a payment, and one list would let an unmatched claim be reconciled by mistake.
export const UnconfirmedClaimsAreKeptApart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Scoped to the section — "Awaiting confirmation" is also a Summary tile label above, so a bare
    // text query matches twice.
    const pending = canvas.getByTestId("billing-payment-pending");
    await expect(pending).toBeVisible();
    await expect(within(pending).getByText("Awaiting confirmation")).toBeVisible();
  },
};

export const Loading: Story = { args: { payments: [], loading: true } };

export const Empty: Story = { args: { payments: [] } };
