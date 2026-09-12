import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { INVOICES, INVOICE_LINES, PAYMENTS } from "../../financeFixtures";
import { InvoicePayableDetailPage, description } from "./index";

const INVOICE = INVOICES.find((i) => i.direction === "payable")!;

const meta = {
  title: "Legacy/Pages/Invoices/Payable/Detail",
  component: InvoicePayableDetailPage,
  parameters: { docs: { description: { component: description } } },
  args: { invoice: INVOICE, lines: INVOICE_LINES, payments: PAYMENTS },
} satisfies Meta<typeof InvoicePayableDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE decision: the OUTSTANDING amount is the headline, not the total. A total stops being
// interesting the moment anything is paid against it.
export const OutstandingIsTheHeadline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("invoice-outstanding")).toBeVisible();
    await expect(canvas.getByTestId("invoice-detail-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// An UNCONFIRMED payment is shown and MARKED. Hiding it would make the outstanding figure look
// wrong; treating it as settled would make it look right when it is not.
export const UnconfirmedPaymentsAreMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("payment-unconfirmed").length).toBeGreaterThan(0);
  },
};

// An overdue invoice says so at the top — it is the only status that needs chasing today.
export const Overdue: Story = {
  args: { invoice: { ...INVOICE, status: "overdue" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("alert")).toHaveTextContent("Past its due date");
  },
};

export const NothingPaidYet: Story = { args: { payments: [] } };
