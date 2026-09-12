import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { CASH_ENTRIES } from "../../fixtures";
import { CashBookPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/CashBook",
  component: CashBookPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: CASH_ENTRIES },
} satisfies Meta<typeof CashBookPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("cash-table")).toBeVisible();
  },
};

// ⚠ AMOUNTS ARE EXACT, NOT COMPACTED. Reconciling a cash box means matching the figure against a
// receipt to the rupiah — "Rp 1,5jt" cannot be matched against anything.
export const AmountsAreExactBecauseTheyAreReconciled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const table = within(canvas.getByTestId("cash-table"));
    await expect(table.getByText(/1\.500\.000|1,500,000/)).toBeVisible();
    await expect(table.queryByText(/1,5jt/)).toBeNull();
  },
};

// ⚠ "UNCATEGORISED" IS A REAL CATEGORY AND THEN MADE VISIBLE. A required field on a screen used
// one-handed produces a WRONG category, not a right one — so the entry is accepted and the count of
// them becomes the task.
export const UncategorisedIsAcceptedThenSurfaced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("uncategorised")).toBeVisible();
    await expect(within(canvas.getByTestId("summary")).getByText("Uncategorised")).toBeVisible();
  },
};

// The note is what makes an entry auditable a month later, so it is a column rather than a hover —
// and its absence is stated rather than left blank.
export const AMissingNoteSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("No note").length).toBeGreaterThan(0);
  },
};

// Recording is the primary action, and it is on this screen because the person holding the receipt
// is standing in the warehouse.
export const RecordingIsThePrimaryAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("add-entry")).toBeVisible();
  },
};

export const OnlyMoneyOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: /^Out$/ }));
    await expect(canvas.getAllByRole("row")).toHaveLength(5);
  },
};

export const NothingRecorded: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("cash-table")).toHaveTextContent("Nothing recorded");
  },
};

export const Loading: Story = { args: { entries: [], loading: true } };
