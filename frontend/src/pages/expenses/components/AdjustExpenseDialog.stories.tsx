import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asRole } from "../../../../.storybook/sessionScenario";
import { expenseScenario, someoneElseAdjusts } from "../../../../.storybook/expenseStub";
import { CURRENT_MONTH, EXPENSE_TEAM } from "../../../../.storybook/expenseFixtures";
import type { ExpenseRecord } from "../../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatDayShort } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import { useExpenses } from "../queries";
import { AdjustExpenseDialog } from "./AdjustExpenseDialog";

// ADJUST EXPENSE — the correction of an expense, as a NEW signed row (every-correction-is-a-signed-adjustment). The
// person types the correction, never the new total; the direction is chosen, so nobody has to remember a minus.
//
// It opens on Toko Melati's #503 — Operational, Electricity, typed as 800.000 and already corrected +50.000, so it
// counts for Rp 850.000 now (expenseFixtures.ts). The month's total is Rp 6.350.000.
//
//   | story                          | the rule it pins                                                              |
//   | ------------------------------ | ----------------------------------------------------------------------------- |
//   | Default                        | which expense, what it counts for now; Reduce chosen; Save waits for an amount |
//   | BelowZeroIsRefusedHere         | a correction past 0 is refused before it is sent, as the server refuses it    |
//   | ACorrectionUpdatesTheList      | saved: the toast, the dialog closes, the expense's net and the month follow    |
//   | AServerRefusalIsShown          | somebody corrected it first: the server's floor refuses, said in the dialog;  |
//   |                                | the list behind refetches, so it reads the 750.000 the server holds now        |
//   | AServerFaultIsSaidPlainly      | the server is down: a translated sentence, never the code or the Go error     |
//   | AdjustShowsTheOriginalsAccount | the account is the original's, read-only — never a picker; the correction     |
//   |                                | posts there (a-correction-follows-the-expenses-account)                        |
//   | AdjustAnOldExpense             | an expense made before Paid from names none: said, and the correction still   |
//   |                                | saves — it moves no balance                                                    |
//
// The dialog is given the expense as the page gives it — the row it read, which may be stale by the time Save is pressed.

const EXPENSE_ID = 503n;

function Harness({ expenseId = EXPENSE_ID }: { expenseId?: bigint }) {
  const query = useExpenses({ teamId: EXPENSE_TEAM, month: CURRENT_MONTH, kind: ExpenseKind.UNSPECIFIED, page: 1, pageSize: 50 });
  // The row the page would have clicked — captured once, as `adjusting` is on the page.
  const [expense, setExpense] = useState<ExpenseRecord | null>(null);
  const [closed, setClosed] = useState(false);

  const live = query.data?.expenses.find((e) => e.id === expenseId);
  if (live && expense === null) setExpense(live);

  return (
    <Stack gap="0" p="card" fontSize="sm" color="fg.muted">
      <Text data-testid="probe-total">{query.data ? formatRupiah(query.data.totals?.total ?? 0n) : "…"}</Text>
      <Text data-testid="probe-net">{live ? formatRupiah(live.netAmount) : "…"}</Text>
      {closed && <Text data-testid="probe-closed">closed</Text>}
      {expense && !closed && <AdjustExpenseDialog teamId={EXPENSE_TEAM} expense={expense} onClose={() => setClosed(true)} />}
    </Stack>
  );
}

const meta = {
  title: "Pages/Expenses/AdjustExpenseDialog",
  // The harness, not the dialog: it hands the dialog the row the page would have read.
  component: Harness,
  beforeEach: asRole(Role.SELLING_OWNER),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened() {
  const dialog = within(await screen.findByTestId("adjust-expense-dialog", {}, { timeout: 4000 }));
  return dialog;
}

// Opened: which expense, on which day, and what it counts for now — the figure the correction moves. Reduce is the
// default direction (a correction is mostly a mistyped number taken down); Save waits for an amount.
export const Default: Story = {
  play: async () => {
    const dialog = await opened();

    await expect(dialog.getByText("Adjust Expense")).toBeInTheDocument();
    await expect(dialog.getByTestId("adjust-expense-now")).toHaveTextContent(
      `Operational · ${formatDayShort(`${CURRENT_MONTH}-03`)} · counts for Rp 850.000 now`,
    );
    await expect(dialog.getByTestId("adjust-direction-reduce")).toHaveAttribute("data-state", "checked");
    await expect(dialog.getByTestId("adjust-after")).toHaveTextContent("After this correction it counts for Rp 850.000.");
    await expect(dialog.getByTestId("submit-adjust")).toBeDisabled();
  },
};

// VALIDATION: the expense and its corrections never sum below 0 — a correction cannot turn a cost into income. Said
// before it is sent; switching the direction to Add makes the same amount fine.
export const BelowZeroIsRefusedHere: Story = {
  play: async () => {
    const dialog = await opened();

    await userEvent.type(dialog.getByTestId("adjust-amount"), "900000", { delay: 40 });
    await expect(dialog.getByTestId("adjust-below-zero")).toHaveTextContent(
      "It counts for Rp 850.000 now — a correction cannot take it below 0.",
    );
    await expect(dialog.getByTestId("submit-adjust")).toBeDisabled();

    await userEvent.click(dialog.getByTestId("adjust-direction-add"));
    await expect(dialog.getByTestId("adjust-after")).toHaveTextContent("Rp 1.750.000");
    await expect(dialog.queryByTestId("adjust-below-zero")).toBeNull();
    await expect(dialog.getByTestId("submit-adjust")).toBeEnabled();
    await expect(expenseScenario.lastAdjust).toBeUndefined();
  },
};

// SAVED: +100.000 — the toast, the dialog closes, and the list behind it refetches: the expense now counts for
// 950.000 and the month is up by the correction. What was sent is the SIGNED correction, never the new total.
export const ACorrectionUpdatesTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await opened();

    await userEvent.click(dialog.getByTestId("adjust-direction-add"));
    await userEvent.type(dialog.getByTestId("adjust-amount"), "100000", { delay: 40 });
    await expect(dialog.getByTestId("adjust-after")).toHaveTextContent("Rp 950.000");
    await userEvent.type(dialog.getByTestId("adjust-note"), "Late fee on the invoice", { delay: 20 });
    await userEvent.click(dialog.getByTestId("submit-adjust"));

    await expect((await screen.findAllByText("Adjustment recorded"))[0]).toBeInTheDocument();
    await expect(await canvas.findByTestId("probe-closed")).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("probe-net")).toHaveTextContent("Rp 950.000"));
    await expect(canvas.getByTestId("probe-total")).toHaveTextContent("Rp 6.450.000");
    await expect(expenseScenario.lastAdjust).toEqual({
      teamId: EXPENSE_TEAM,
      expenseId: EXPENSE_ID,
      amount: 100_000,
      note: "Late fee on the invoice",
    });
  },
};

// THE SERVER REFUSES: the dialog still reads 850.000, but a colleague has meanwhile taken 100.000 off — so reducing by
// 850.000 passes here and would take it to −100.000 there. The server's words are said in the dialog, which stays open
// with the amount still typed; nothing is recorded — and the list behind REFETCHES on the refusal (queries.ts), so it
// stops showing the stale 850.000 that caused it.
export const AServerRefusalIsShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await opened();

    await userEvent.type(dialog.getByTestId("adjust-amount"), "850000", { delay: 40 });
    await expect(dialog.getByTestId("adjust-after")).toHaveTextContent("Rp 0");
    someoneElseAdjusts(EXPENSE_ID, -100_000);
    await userEvent.click(dialog.getByTestId("submit-adjust"));

    const said = await dialog.findByTestId("adjust-form-error");
    await expect(said).toHaveTextContent("the correction would take the expense below 0");
    // The server's sentence alone — never the Connect code in brackets before it.
    await expect(said).not.toHaveTextContent("[failed_precondition]");
    await expect(dialog.getByTestId("adjust-amount")).toHaveValue("850.000");
    await expect(canvas.queryByTestId("probe-closed")).toBeNull();
    // A stale-figure refusal invalidates the list: it now reads what the server holds — 850.000 less the colleague's
    // 100.000 — and the month's total with it.
    await waitFor(() => expect(canvas.getByTestId("probe-net")).toHaveTextContent("Rp 750.000"));
    await expect(canvas.getByTestId("probe-total")).toHaveTextContent("Rp 6.250.000");
  },
};

// A SERVER FAULT, not a refusal: the service is down and the answer is Unavailable with a Go error's text. That text is
// for whoever debugs it, so the dialog says the translated sentence for the code instead — never "[unavailable]", never
// "dial tcp". Nothing is recorded and the amount stays typed, so Save can simply be pressed again.
export const AServerFaultIsSaidPlainly: Story = {
  play: async () => {
    const dialog = await opened();

    await userEvent.type(dialog.getByTestId("adjust-amount"), "50000", { delay: 40 });
    expenseScenario.faultNextAdjust = true;
    await userEvent.click(dialog.getByTestId("submit-adjust"));

    const said = await dialog.findByTestId("adjust-form-error");
    await expect(said).toHaveTextContent("The server cannot be reached right now. Try again in a moment.");
    await expect(said).not.toHaveTextContent(/unavailable|dial tcp|expense_service/);
    await expect(dialog.getByTestId("adjust-amount")).toHaveValue("50.000");

    // Pressed again, it goes through.
    await userEvent.click(dialog.getByTestId("submit-adjust"));
    await waitFor(() => expect(expenseScenario.lastAdjust?.amount).toBe(-50_000));
  },
};

// THE ORIGINAL'S ACCOUNT, READ-ONLY (a-correction-follows-the-expenses-account): #503 was paid from ShopeePay Melati, so
// its correction posts there. Said as a sentence — no picker, nothing to choose — and the request names no account: the
// server takes it from the expense.
export const AdjustShowsTheOriginalsAccount: Story = {
  play: async () => {
    const dialog = await opened();

    await waitFor(() =>
      expect(dialog.getByTestId("adjust-paid-from")).toHaveTextContent("Paid from ShopeePay Melati — the correction posts here."),
    );
    await expect(dialog.queryByTestId("expense-paid-from")).toBeNull();
    await expect(dialog.queryByRole("combobox")).toBeNull();

    await userEvent.type(dialog.getByTestId("adjust-amount"), "50000", { delay: 40 });
    await userEvent.click(dialog.getByTestId("submit-adjust"));
    await waitFor(() => expect(expenseScenario.lastAdjust?.amount).toBe(-50_000));
    await expect(Object.keys(expenseScenario.lastAdjust!)).not.toContain("financeAccountId");
  },
};

// AN OLD EXPENSE — #502, recorded before Paid from — names no account. The dialog says so: its correction moves no
// balance. It is still correctable; the correction saves as any other.
export const AdjustAnOldExpense: Story = {
  args: { expenseId: 502n },
  play: async () => {
    const dialog = await opened();

    await expect(dialog.getByTestId("adjust-paid-from")).toHaveTextContent(
      "This expense names no account, so the correction moves no balance.",
    );
    await expect(dialog.getByTestId("adjust-expense-now")).toHaveTextContent("Payroll");

    await userEvent.type(dialog.getByTestId("adjust-amount"), "100000", { delay: 40 });
    await userEvent.click(dialog.getByTestId("submit-adjust"));
    await waitFor(() => expect(expenseScenario.lastAdjust).toMatchObject({ expenseId: 502n, amount: -100_000 }));
  },
};
