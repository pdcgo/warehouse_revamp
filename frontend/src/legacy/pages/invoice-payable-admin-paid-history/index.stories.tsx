import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { PAYMENTS } from "../../financeFixtures";
import { InvoicePayableAdminPaidHistoryPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Invoices/PayableAdmin/PaidHistory",
  component: InvoicePayableAdminPaidHistoryPage,
  parameters: { docs: { description: { component: description } } },
  args: { payments: PAYMENTS },
} satisfies Meta<typeof InvoicePayableAdminPaidHistoryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("paid-history-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// Only CONFIRMED payments appear — this screen answers "has it landed", and an unconfirmed
// claim answering that question would be a lie.
export const OnlyConfirmedPayments: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("TRX-88213")).toBeVisible();
    // TRX-90011 is claimed but unconfirmed — it belongs on the requests screen, not here.
    await expect(canvas.queryByText("TRX-90011")).toBeNull();
  },
};

// The reference is a first-class COLUMN — it is the string somebody quotes when asking whether a
// transfer landed.
export const ReferenceIsAColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Reference")).toBeVisible();
  },
};

export const Loading: Story = { args: { payments: [], loading: true } };

export const Empty: Story = { args: { payments: [] } };
