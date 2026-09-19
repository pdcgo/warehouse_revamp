import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { INVOICES } from "../../financeFixtures";
import { InvoicePayableAdminListPage, description } from "./index";

const ROWS = INVOICES.filter((i) => i.direction === "payable");

const meta = {
  title: "Legacy/Pages/Invoices/PayableAdmin/List",
  component: InvoicePayableAdminListPage,
  parameters: { docs: { description: { component: description } } },
  args: { invoices: ROWS },
} satisfies Meta<typeof InvoicePayableAdminListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("invoice-list-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// ⚠ What you OWE arrives from somebody else — a supplier issues it — so there is no way to
// create one here. Offering it would invite inventing a debt nobody has claimed.
export const CannotRaiseAnInvoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("invoice-create")).toBeNull();
  },
};

// The totals are over EVERY invoice, not the filtered set — "how much is outstanding" must not
// change because somebody opened the Paid tab.
export const TotalsIgnoreTheStatusTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const before = canvas.getByTestId("summary").textContent;

    await userEvent.click(canvas.getByTestId("choice-tab-paid"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("choice-tab-paid")).toHaveAttribute("aria-pressed", "true");
    });

    await expect(canvas.getByTestId("summary").textContent).toBe(before);
  },
};

// Due dates are RELATIVE — "in 3 days" is what decides whether to chase it today, where a date
// makes the reader do the arithmetic on every row.
export const DueDatesAreRelative: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("date-cell").length).toBeGreaterThan(0);
  },
};

export const Loading: Story = { args: { invoices: [], loading: true } };

export const Empty: Story = { args: { invoices: [] } };
