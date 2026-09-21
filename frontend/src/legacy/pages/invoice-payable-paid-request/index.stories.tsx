import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { PAYMENTS } from "../../financeFixtures";
import { InvoicePayablePaidRequestPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Invoices/Payable/PaidRequest",
  component: InvoicePayablePaidRequestPage,
  parameters: { docs: { description: { component: description } } },
  args: { requests: PAYMENTS },
} satisfies Meta<typeof InvoicePayablePaidRequestPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("paid-request-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// ⚠ It says outright that these are NOT counted. Somebody reading a balance while these sit here
// needs to know the balance does not include them.
export const SaysTheseAreNotCountedYet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("paid-request-warning")).toHaveTextContent(/not counted in any balance/i);
  },
};

// The only one of the three history screens with ACTIONS — it is a work queue, not a record.
export const IsAWorkQueue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("action-Confirm").length).toBeGreaterThan(0);
    await expect(canvas.getAllByTestId("action-Reject").length).toBeGreaterThan(0);
  },
};

export const Loading: Story = { args: { requests: [], loading: true } };

export const Empty: Story = { args: { requests: [] } };
