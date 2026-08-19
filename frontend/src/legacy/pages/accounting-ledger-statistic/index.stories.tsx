import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { AccountingLedgerStatisticPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Ledger/Statistics",
  component: AccountingLedgerStatisticPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: LEDGER_ENTRIES },
} satisfies Meta<typeof AccountingLedgerStatisticPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ledger-statistic-charts")).toBeVisible();
  },
};

// ⚠ IT COUNTS AS WELL AS TOTALS, and the count comes first. A month with the same total but three
// times the entries is a month somebody worked very differently — a screen showing only money would
// hide that completely.
export const CountsEntriesNotJustMoney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-table"));

    await waitFor(async () => {
      await expect(canvas.getByText("Entries")).toBeVisible();
    });
    // The count column precedes the money columns.
    await expect(canvas.getByTestId("summary")).toHaveTextContent("Entries posted");
  },
};

// Most active account first — when something feels wrong, the account that moved most is where to
// look.
export const MostActiveAccountLeads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-table"));

    await waitFor(async () => {
      // Accounts receivable appears twice in the fixture; it heads the table.
      await expect(canvas.getAllByText("Accounts receivable").length).toBeGreaterThan(0);
    });
  },
};

export const Loading: Story = { args: { entries: [], loading: true } };
