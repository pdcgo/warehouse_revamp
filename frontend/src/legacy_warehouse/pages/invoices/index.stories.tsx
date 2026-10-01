import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FLOOR_INVOICES } from "../../fixtures";
import { InvoicesPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Invoices",
  component: InvoicesPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: FLOOR_INVOICES },
} satisfies Meta<typeof InvoicesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("paid-progress")).toHaveLength(4);
  },
};

// ⚠ THE INTERESTING DECISION IS WHAT IS NOT HERE. No issuing, no editing, no payment recording — an
// operator with a scanner in one hand should not be able to edit a financial document.
export const ReadOnlyByDesign: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
    await expect(canvas.getByTestId("read-only-note")).toHaveTextContent("Read-only here");
  },
};

// ⚠ PART PAID AND OVERDUE IS TWO STATES AT ONCE. The status says overdue; the bar says 29% arrived.
// Showing only one of them either hides a payment that was made or hides that it was late.
export const PartPaidAndOverdueAreBothVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("INV-2026-1203").closest("tr")!;
    await expect(within(row).getByText("overdue")).toBeVisible();
    await expect(within(row).getByTestId("paid-progress")).toHaveAttribute("data-percent", "29");
  },
};

export const FullyPaid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("INV-2026-1201").closest("tr")!;
    await expect(within(row).getByTestId("paid-progress")).toHaveAttribute("data-percent", "100");
  },
};

// A draft with nothing paid is not the same as an overdue with nothing paid, and the tone carries
// that even though the bar is empty in both cases.
export const NothingPaidYet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("INV-2026-1204").closest("tr")!;
    await expect(within(row).getByTestId("paid-progress")).toHaveAttribute("data-percent", "0");
    await expect(within(row).getByText("draft")).toBeVisible();
  },
};

export const NoInvoices: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("invoices-table")).toHaveTextContent("No invoices");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
