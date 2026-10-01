import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { DAY_TOTALS } from "../../financeFixtures";
import { InvoicePayableAdminDayHistoryPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Invoices/PayableAdmin/DayHistory",
  component: InvoicePayableAdminDayHistoryPage,
  parameters: { docs: { description: { component: description } } },
  args: { days: DAY_TOTALS },
} satisfies Meta<typeof InvoicePayableAdminDayHistoryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("day-history-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// Its rows are DAYS, not invoices — this is a period ledger read to reconcile against a bank
// statement, which is why it is a separate screen rather than a tab on the invoice list.
export const RowsAreDaysNotInvoices: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Day")).toBeVisible();
    await expect(canvas.queryByText("Invoice")).toBeNull();
  },
};

// Chart and table are the SAME figures — reconciling needs both the shape and the numbers.
export const ChartView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-chart"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("chart")).toBeVisible();
    });
  },
};

export const Loading: Story = { args: { days: [], loading: true } };

export const Empty: Story = { args: { days: [] } };
