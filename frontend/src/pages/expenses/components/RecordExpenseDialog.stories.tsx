import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asRole } from "../../../../.storybook/sessionScenario";
import { expenseScenario } from "../../../../.storybook/expenseStub";
import { BCA_OPERASIONAL, CURRENT_MONTH, EXPENSE_TEAM, SHOPEEPAY_MELATI } from "../../../../.storybook/expenseFixtures";
import { noOperationalAccountForStory, unmarkOperationalForStory } from "../../../../.storybook/financialAccountStub";
import { shops } from "../../../../.storybook/fixtures";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { todayWibDateInput } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import { useExpenses } from "../queries";
import { RecordExpenseDialog } from "./RecordExpenseDialog";

// RECORD EXPENSE — the dialog behind the expenses screen's Record button (#170). It only ever RECORDS
// (an-expense-is-never-edited); a mistake is corrected by AdjustExpenseDialog.
//
//   | story                          | the rule it pins                                                              |
//   | ------------------------------ | ----------------------------------------------------------------------------- |
//   | Default                        | opens on today, no kind pre-picked, Save off                                  |
//   | SaveNeedsAKindAndAnAmount      | the two things the server refuses without — Save waits for both               |
//   | RecordingUpdatesTheList        | saved: the toast, the dialog closes, the month's list and totals refetch      |
//   | ARefusalIsSaidInTheDialog      | the server refuses (a note past 500): said in the dialog, which stays open    |
//   | TodayIsJakartasDay             | 01:30 WIB on the 1st is the 1st, not the UTC day before — nor last month       |
//   | RecordNeedsPaidFrom            | Paid from is required: the team's operational accounts only, Save waits for   |
//   |                                | it, and the payload carries it (an-expense-must-name-the-account-that-paid)    |
//   | RecordWithNoOperationalAccount | no operational account: the picker says so, a hint links to Accounts, and Save |
//   |                                | stays off — the form cannot be sent, as a restock's cannot                    |
//   | ShopIsOnlyForAds               | the shop shows on Ads only and is required there; any other kind sends 0      |
//   | ARefusedAccountIsSaidCleanly   | an account unmarked since the picker loaded: the server's FailedPrecondition  |
//   |                                | names it in the dialog, the pick drops and the picker re-reads what may pay   |
//
// Beside the dialog, THE MONTH'S LIST AS THE PAGE READS IT — the real useExpenses hook, so a story sees that saving
// invalidates it (queries.ts declares that, not the page).

function MonthProbe() {
  const query = useExpenses({ teamId: EXPENSE_TEAM, month: CURRENT_MONTH, kind: ExpenseKind.UNSPECIFIED, page: 1, pageSize: 50 });

  return (
    <Stack gap="0" fontSize="sm" color="fg.muted">
      <Text data-testid="probe-total">{query.data ? formatRupiah(query.data.totals?.total ?? 0n) : "…"}</Text>
      <Text data-testid="probe-count">{query.data ? `${query.data.totalItems} rows` : "…"}</Text>
    </Stack>
  );
}

const meta = {
  title: "Pages/Expenses/RecordExpenseDialog",
  component: RecordExpenseDialog,
  args: { teamId: EXPENSE_TEAM },
  beforeEach: asRole(Role.SELLING_OWNER),
  render: (args) => (
    <Stack gap="card" p="card" align="start">
      <RecordExpenseDialog {...args} />
      <MonthProbe />
    </Stack>
  ),
} satisfies Meta<typeof RecordExpenseDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Jakarta's today — what the dialog pre-fills (TodayIsJakartasDay pins why it is not the UTC day).
const today = () => todayWibDateInput();

/**
 * THE CLOCK, MOVED — `new Date()` and `Date.now()` read `iso` (and keep ticking from it) until the returned function puts
 * the real one back. Only what reads the clock moves: a Date built from a value is still that value.
 */
function fakeClock(iso: string): () => void {
  const Real = Date;
  const offset = Real.parse(iso) - Real.now();

  class Fake extends Real {
    constructor(...args: [number] | []) {
      if (args.length === 0) super(Real.now() + offset);
      else super(...args);
    }

    static now() {
      return Real.now() + offset;
    }
  }

  globalThis.Date = Fake as DateConstructor;
  return () => {
    globalThis.Date = Real;
  };
}

async function open(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(await canvas.findByTestId("probe-total", {}, { timeout: 4000 })).toHaveTextContent("Rp 6.350.000");
  await userEvent.click(canvas.getByTestId("open-record-cost"));
  await screen.findByTestId("submit-cost");
  return canvas;
}

/** Pick Paid from — one of the team's operational accounts, in the restock form's picker. */
async function pickAccount(accountId: bigint) {
  await userEvent.click(screen.getByTestId("expense-paid-from"));
  const option = await screen.findByTestId(`expense-paid-from-option-${accountId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** Pick a shop — offered on Ads only. */
async function pickShop(shopId: bigint) {
  await userEvent.click(within(screen.getByTestId("expense-shop-field")).getByTestId("shop-select"));
  const option = await screen.findByTestId(`shop-select-option-${shopId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function pickKind(kind: ExpenseKind) {
  await userEvent.click(screen.getByTestId("expense-kind-select"));
  const option = await screen.findByTestId(`expense-kind-select-${kind}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// Opened: the date is today's (the day it belongs to, chosen), the kind is NOT pre-picked — filing rent as ads for
// anybody who did not look is worse than a placeholder — and Save waits.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);

    await expect(screen.getByText("Record Expense", { selector: "h2" })).toBeInTheDocument();
    await expect(screen.getByTestId("expense-kind-select")).toHaveTextContent("Choose a kind");
    await expect(screen.getByTestId("expense-amount")).toHaveValue("");
    await expect(screen.getByText(/payroll paid on the 5th is last month's expense/)).toBeInTheDocument();
    await expect(screen.getByTestId("submit-cost")).toBeDisabled();
  },
};

// VALIDATION: a kind and a real amount are what the contract refuses without. One alone does not press.
export const SaveNeedsAKindAndAnAmount: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    const save = screen.getByTestId("submit-cost");

    await userEvent.type(screen.getByTestId("expense-amount"), "250000", { delay: 40 });
    // Grouped as money is written here; the form holds the raw digits.
    await expect(screen.getByTestId("expense-amount")).toHaveValue("250.000");
    await expect(save).toBeDisabled();

    await userEvent.clear(screen.getByTestId("expense-amount"));
    await pickKind(ExpenseKind.PAYROLL);
    await expect(save).toBeDisabled();

    await userEvent.type(screen.getByTestId("expense-amount"), "250000", { delay: 40 });
    // The kind and the amount alone are not enough now: the account that paid is still missing.
    await expect(save).toBeDisabled();
    await expect(screen.getByTestId("expense-form-missing")).toHaveTextContent("the account that paid");
    await pickAccount(BCA_OPERASIONAL);
    await expect(save).toBeEnabled();
    await expect(screen.queryByTestId("expense-form-missing")).toBeNull();
    await expect(expenseScenario.lastCreate).toBeUndefined();
  },
};

// SAVED: the toast, the dialog closes, and the month behind it refetches — one more row, the total up by what was
// typed. What was sent is what the form held: the kind, the raw amount, today, the shop, the note.
export const RecordingUpdatesTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await pickKind(ExpenseKind.ADS);
    await userEvent.type(screen.getByTestId("expense-amount"), "750000", { delay: 40 });
    // Ads names its shop — Melati Store's ads here — and the account that paid.
    const melatiStore = shops[1]!;
    await pickShop(melatiStore.id);
    await pickAccount(BCA_OPERASIONAL);
    await userEvent.type(screen.getByTestId("expense-note"), "Tokopedia ads — week 2", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-cost"));

    await expect((await screen.findAllByText("Expense recorded"))[0]).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("submit-cost")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("probe-total")).toHaveTextContent("Rp 7.100.000"));
    await expect(canvas.getByTestId("probe-count")).toHaveTextContent("7 rows");
    await expect(expenseScenario.lastCreate).toEqual({
      teamId: EXPENSE_TEAM,
      kind: ExpenseKind.ADS,
      amount: 750_000,
      occurredAt: today(),
      shopId: melatiStore.id,
      note: "Tokopedia ads — week 2",
      financeAccountId: BCA_OPERASIONAL,
    });

    // Opened again, it is a fresh form.
    await userEvent.click(canvas.getByTestId("open-record-cost"));
    await expect(await screen.findByTestId("expense-amount")).toHaveValue("");
    await expect(screen.getByTestId("expense-note")).toHaveValue("");
  },
};

// THE SERVER REFUSES — a note past the contract's 500 characters (the field has no limit of its own). The server's words
// are said in the dialog, which stays open with everything still typed; nothing is recorded.
export const ARefusalIsSaidInTheDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await pickKind(ExpenseKind.OTHER);
    await userEvent.type(screen.getByTestId("expense-amount"), "90000", { delay: 40 });
    await pickAccount(BCA_OPERASIONAL);
    await userEvent.click(screen.getByTestId("expense-note"));
    await userEvent.paste("x".repeat(501));
    await userEvent.click(screen.getByTestId("submit-cost"));

    await expect(await screen.findByTestId("expense-form-error")).toHaveTextContent(
      "note: value length must be at most 500 characters",
    );
    await expect(screen.getByTestId("submit-cost")).toBeInTheDocument();
    await expect(screen.getByTestId("expense-amount")).toHaveValue("90.000");
    await expect(canvas.getByTestId("probe-count")).toHaveTextContent("6 rows");
    await expect(canvas.getByTestId("probe-total")).toHaveTextContent("Rp 6.350.000");
    // Refused at the validation, before the service wrote anything.
    await expect(expenseScenario.lastCreate).toBeUndefined();
  },
};

// TODAY IS JAKARTA'S DAY. At 01:30 WIB on 1 December it is 18:30 UTC on 30 November: the UTC day pre-filled the 30th —
// last month, a month the screen was not showing. The dialog reads Jakarta's day, when it OPENS (a page left open
// overnight offers the new day), and sends it.
export const TodayIsJakartasDay: Story = {
  play: async ({ canvasElement }) => {
    // The boundary, both sides: 06:59 WIB is still the WIB day, 07:00 WIB is UTC's next one — the same answer.
    await expect(todayWibDateInput(new Date("2026-11-30T18:30:00Z"))).toBe("2026-12-01");
    await expect(todayWibDateInput(new Date("2026-11-30T16:59:59Z"))).toBe("2026-11-30");
    await expect(todayWibDateInput(new Date("2026-11-30T17:00:00Z"))).toBe("2026-12-01");
    await expect(todayWibDateInput(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");

    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("probe-total", {}, { timeout: 4000 })).toHaveTextContent("Rp 6.350.000");

    const restore = fakeClock("2026-11-30T18:30:00Z");
    try {
      await userEvent.click(canvas.getByTestId("open-record-cost"));
      await screen.findByTestId("submit-cost");
      await pickKind(ExpenseKind.OPERATIONAL);
      await userEvent.type(screen.getByTestId("expense-amount"), "120000", { delay: 40 });
      await pickAccount(BCA_OPERASIONAL);
      await userEvent.click(screen.getByTestId("submit-cost"));

      await waitFor(() => expect(expenseScenario.lastCreate?.occurredAt).toBe("2026-12-01"));
    } finally {
      restore();
    }
  },
};

// PAID FROM IS REQUIRED (an-expense-must-name-the-account-that-paid): the picker is the restock form's, narrowed to the
// team's OPERATIONAL accounts — BCA Operasional and ShopeePay Melati, never BCA Gaji (not operational), the archived BNI
// Lama, or an unknown one. Two to choose from, so nothing is pre-picked; Save waits, and says why. What was sent names
// the account.
export const RecordNeedsPaidFrom: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    const save = screen.getByTestId("submit-cost");

    await pickKind(ExpenseKind.OPERATIONAL);
    await userEvent.type(screen.getByTestId("expense-amount"), "300000", { delay: 40 });
    await expect(screen.getByTestId("expense-paid-from")).toHaveTextContent("Choose an account");
    await expect(screen.getByTestId("expense-form-missing-account")).toBeInTheDocument();
    await expect(save).toBeDisabled();

    await userEvent.click(screen.getByTestId("expense-paid-from"));
    await waitFor(() => expect(screen.getByTestId(`expense-paid-from-option-${BCA_OPERASIONAL}`)).toBeVisible());
    await expect(screen.getByTestId(`expense-paid-from-option-${SHOPEEPAY_MELATI}`)).toBeVisible();
    await expect(screen.queryByText("BCA Gaji")).toBeNull();
    await expect(screen.queryByText("BNI Lama")).toBeNull();
    await userEvent.click(screen.getByTestId(`expense-paid-from-option-${SHOPEEPAY_MELATI}`));

    await waitFor(() => expect(save).toBeEnabled());
    await expect(screen.getByTestId("expense-paid-from")).toHaveTextContent("ShopeePay Melati");
    await userEvent.click(save);

    await waitFor(() => expect(expenseScenario.lastCreate?.financeAccountId).toBe(SHOPEEPAY_MELATI));
    await expect(expenseScenario.lastCreate?.shopId).toBe(0n);
  },
};

// NO OPERATIONAL ACCOUNT: nothing may pay, so the form cannot be sent — as for a restock. The picker says so (and is
// off), a hint says an admin marks one and links to the accounts page, and Save stays off whatever else is filled in.
export const RecordWithNoOperationalAccount: Story = {
  beforeEach: () => noOperationalAccountForStory(EXPENSE_TEAM),
  play: async ({ canvasElement }) => {
    await open(canvasElement);

    await pickKind(ExpenseKind.PAYROLL);
    await userEvent.type(screen.getByTestId("expense-amount"), "4000000", { delay: 20 });

    const hint = await screen.findByTestId("expense-no-operational", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("This team has no operational account");
    await expect(screen.getByTestId("expense-open-accounts")).toHaveAttribute("href", "/financial-accounts");
    await expect(screen.getByTestId("expense-paid-from")).toHaveTextContent("No operational account — ask an admin to mark one");
    await expect(screen.getByTestId("expense-paid-from")).toBeDisabled();
    await expect(screen.getByTestId("expense-form-missing-account")).toBeInTheDocument();
    await expect(screen.getByTestId("submit-cost")).toBeDisabled();
  },
};

// THE SHOP IS FOR ADS ONLY, AND ADS NEEDS ONE (owner, 2026-11-04). Payroll: no shop field, and the payload sends shop 0.
// Ads: the field appears, required — Save waits for it. Back to Payroll, the picked shop is cleared, so it is never sent.
export const ShopIsOnlyForAds: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    const save = screen.getByTestId("submit-cost");

    await pickKind(ExpenseKind.PAYROLL);
    await expect(screen.queryByTestId("expense-shop-field")).toBeNull();
    await userEvent.type(screen.getByTestId("expense-amount"), "500000", { delay: 20 });
    await pickAccount(BCA_OPERASIONAL);
    await expect(save).toBeEnabled();

    await pickKind(ExpenseKind.ADS);
    await expect(await screen.findByTestId("expense-shop-field")).toBeVisible();
    await expect(screen.getByTestId("expense-form-missing-shop")).toHaveTextContent("the shop the ads ran for");
    await expect(save).toBeDisabled();
    await pickShop(shops[0]!.id);
    await waitFor(() => expect(save).toBeEnabled());

    // Away from Ads: the field goes, and so does the pick.
    await pickKind(ExpenseKind.PAYROLL);
    await waitFor(() => expect(screen.queryByTestId("expense-shop-field")).toBeNull());
    await userEvent.click(save);

    await waitFor(() => expect(expenseScenario.lastCreate?.kind).toBe(ExpenseKind.PAYROLL));
    await expect(expenseScenario.lastCreate?.shopId).toBe(0n);
    await expect(expenseScenario.lastCreate?.financeAccountId).toBe(BCA_OPERASIONAL);
  },
};

// AN ACCOUNT THAT MAY NO LONGER PAY (an-expense-must-name-the-account-that-paid): BCA Operasional is picked, then an admin
// unmarks it before Save. The server refuses — FailedPrecondition, naming the account — and its words are said in the
// dialog, which stays open; the pick drops and the picker re-reads the team's operational accounts, so BCA Operasional
// is gone from it. Nothing is recorded.
export const ARefusedAccountIsSaidCleanly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await pickKind(ExpenseKind.PAYROLL);
    await userEvent.type(screen.getByTestId("expense-amount"), "2000000", { delay: 20 });
    await pickAccount(BCA_OPERASIONAL);
    unmarkOperationalForStory(BCA_OPERASIONAL);
    await userEvent.click(screen.getByTestId("submit-cost"));

    await expect(await screen.findByTestId("expense-form-error")).toHaveTextContent(
      "BCA Operasional is not one of the team's active operational accounts — pick another, or ask an admin to mark it operational",
    );
    await expect(screen.getByTestId("submit-cost")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("expense-paid-from")).not.toHaveTextContent("BCA Operasional"));
    await expect(screen.getByTestId("expense-amount")).toHaveValue("2.000.000");
    await expect(canvas.getByTestId("probe-count")).toHaveTextContent("6 rows");
    await expect(expenseScenario.lastCreate).toBeUndefined();
  },
};
