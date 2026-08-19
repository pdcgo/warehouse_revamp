import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { LEDGER_ENTRIES } from "../../financeFixtures";
import { AccountingAdjustmentPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Adjustment",
  component: AccountingAdjustmentPage,
  parameters: { docs: { description: { component: description } } },
  args: { entries: LEDGER_ENTRIES, recent: LEDGER_ENTRIES.slice(0, 2), onSubmit: fn() },
} satisfies Meta<typeof AccountingAdjustmentPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ The screen states the rule it exists to enforce: entries are never edited. An edited entry would
// leave no history, and no trial balance would prove anything about the past.
export const SaysWhyEditingIsNotOffered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("adjustment-note")).toHaveTextContent(/never edited/i);
  },
};

// All three are required, and the REASON has to be a sentence — a two-word explanation is what
// causes the argument six months later.
export const AllThreeAreRequiredAndTheReasonMustBeASentence: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("adjustment-submit")).toBeDisabled();

    await userEvent.selectOptions(canvas.getByLabelText("Entry being corrected"), "1");
    await userEvent.type(canvas.getByTestId("adjustment-amount"), "240000", { delay: 10 });
    // A two-word reason is still not enough.
    await userEvent.type(canvas.getByTestId("adjustment-reason"), "wrong", { delay: 10 });
    await expect(canvas.getByTestId("adjustment-submit")).toBeDisabled();

    await userEvent.type(
      canvas.getByTestId("adjustment-reason"),
      " amount, double-posted on the 14th",
      { delay: 5 },
    );
    await waitFor(async () => {
      await expect(canvas.getByTestId("adjustment-submit")).toBeEnabled();
    });

    await userEvent.click(canvas.getByTestId("adjustment-submit"));
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};

export const NoRecentAdjustments: Story = { args: { recent: [] } };
