import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { AccountingLedgerAccountEntryPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Ledger/AccountEntries",
  component: AccountingLedgerAccountEntryPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: LEDGER_ENTRIES },
} satisfies Meta<typeof AccountingLedgerAccountEntryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ NO EDIT, NO DELETE. A posted entry is a historical fact — correcting one means posting an
// adjustment that references it. A screen that let somebody quietly change the past would make the
// trial balance meaningless, because nothing would say the books had moved.
export const EntriesCannotBeEditedOrDeleted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ledger-entry-page")).toBeVisible();
    await expect(canvas.queryByTestId("action-cell")).toBeNull();
  },
};

// Debit and credit stay SEPARATE — an entry is one side or the other, and collapsing them into a
// signed number loses which.
export const DebitAndCreditAreSeparate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Debit")).toBeVisible();
    await expect(canvas.getByText("Credit")).toBeVisible();
  },
};

export const FilteredToOneAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(canvas.getByLabelText("Account"), "Bank");

    await waitFor(async () => {
      await expect(canvas.queryByText("INV-9001 issued")).toBeNull();
    });
  },
};

export const Loading: Story = { args: { entries: [], loading: true } };

export const Empty: Story = { args: { entries: [] } };
