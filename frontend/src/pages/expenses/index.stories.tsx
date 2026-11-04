import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { expenseScenario, someoneElseAdjusts } from "../../../.storybook/expenseStub";
import {
  BCA_OPERASIONAL,
  CURRENT_MONTH,
  EMPTY_MONTH,
  EXPENSE_TEAM,
  FIRST_NEW_EXPENSE_ID,
  LAST_MONTH,
  QUIET_TEAM,
} from "../../../.storybook/expenseFixtures";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatDayShort, todayWibDateInput } from "../../lib/datetime";
import { thisMonth } from "../../lib/period";
import { ExpensesPage } from "./index";

// EXPENSES — the money a team spent that no order caused (#170). expenseStub.ts plays the server's rules
// (expense_service/expense_v1); the e2e (e2e/expenses.spec.ts) pins the same life against a real database.
//
// Toko Melati (12), signed in as its Owner — this month (expenseFixtures.ts):
//
//   #502  Payroll      Rp 4.000.000   day 05
//   #506    adjustment −Rp 200.000    day 04   ← cancels #505
//   #505  Other        Rp   200.000   day 04   counts for Rp 0 now
//   #504    adjustment +Rp 50.000     day 03   ← corrects #503
//   #503  Operational  Rp   800.000   day 03   counts for Rp 850.000 now
//   #501  Ads          Rp 1.500.000   day 02
//   totals: Ads 1.500.000 · Payroll 4.000.000 · Operational 850.000 → Rp 6.350.000
//
//   | story                                  | the rule it pins                                                         |
//   | -------------------------------------- | ------------------------------------------------------------------------ |
//   | ThisMonth                              | opens on this month; newest day first; totals are the month's, by kind;    |
//   |                                        | a day reads short, "5 Nov" — never "2026-11-05"                            |
//   | ThisMonthIsJakartas                    | "this month" is the WIB month, at a pinned clock across a month and a year |
//   | AnEmptyMonth                           | a team that recorded nothing: the table, the hint, every card Rp 0         |
//   | AnAdjustedExpense                      | the expense keeps its amount and says what it counts for; its correction   |
//   |                                        | is a muted signed row of its own, with no actions                          |
//   | ACancelledExpense                      | cancelled = counts for 0; Adjust is still offered, Cancel no longer        |
//   | AnotherMonth                           | the month is the URL's; last month shows only its own; an empty one none  |
//   | FilterByKind                           | the kind narrows the rows AND the totals, and lives in the URL             |
//   | RecordAnExpense                        | a recorded expense lands on the list and in the totals                     |
//   | AdjustAnExpense                        | a correction is a new row; the totals follow; the expense never changes   |
//   | CancelAnExpense                        | Batalkan confirms, then writes minus what is left; every row stays         |
//   | ACancelRefusedIsSaid                   | somebody corrected it first: the server's floor refuses, said in a toast;  |
//   |                                        | the list refetches, so it reads what the expense counts for NOW           |
//   | AnAdjustRefusedShowsTheFigureNow       | the same refusal from Adjust: the open dialog reads the refreshed figure   |
//   | AMonitorReadsOnly                      | the admin team's monitor reads the month and changes nothing               |
//   | CustomerServiceIsRefused               | money out is not CS's business — the server refuses, the page says so;     |
//   |                                        | no Record, no table under the refusal                                      |
//   | Phone                                  | a phone's own drawing: one-row header, Record an icon, a block per expense |
//   | PhoneRowActions                        | a phone block's ⋯ holds Adjust and Cancel                                  |
//   | PhoneEmptyMonth                        | a phone, a team that recorded nothing                                      |
//   | TheListNamesThePayingAccount           | each row names the account that paid; an adjustment its expense's          |
//   | TheListNamesThePayingAccountOnAPhone   | the same, in each phone block, beside the day                              |
//   | AnOldExpenseHasNoAccount               | an expense made before Paid from says "No account"; its older shop stays   |
//   | CancelSaysWhereTheMoneyGoes            | the cancel confirm names the account that gets the money back — or that    |
//   |                                        | an old expense moves no balance                                            |

const Routed = routedPage(
  [
    {
      path: "/expenses",
      element: (
        <>
          <ExpensesPage />
          <LocationProbe />
        </>
      ),
    },
  ],
  "/expenses",
);

const meta = {
  title: "Pages/Expenses/ExpensesPage",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(EXPENSE_TEAM)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const NEW_ID = FIRST_NEW_EXPENSE_ID.toString();

async function loaded(canvasElement: HTMLElement, first = "expense-row-502") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  return canvas;
}

const rowOrder = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("expenses-table"))
    .queryAllByTestId(/^expense-row-\d+$/)
    .map((el) => el.dataset.testid);

/** The row's ⋯ menu is shut — gone from the DOM, or still mounted but hidden (it portals and animates out). */
async function menuClosed(id: string) {
  await waitFor(() => {
    const item = screen.queryByTestId(`expense-adjust-${id}`);
    if (item) expect(item).not.toBeVisible();
  });
}

/** Open a row's overflow menu and wait for it — the menu portals and animates in. */
async function openActions(canvas: ReturnType<typeof within>, id: string) {
  await userEvent.click(canvas.getByTestId(`expense-actions-${id}`));
  const adjust = await screen.findByTestId(`expense-adjust-${id}`);
  await waitFor(() => expect(adjust).toBeVisible());
}

// THIS MONTH: the period is the first control and opens on this month. Newest day first, an adjustment just above the
// expense it corrects; the totals are the whole month's, per kind, and Other's 200.000 and its cancel net to nothing.
export const ThisMonth: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("expenses-month")).toHaveValue(CURRENT_MONTH);
    await expect(canvas.getByText("Toko Melati")).toBeInTheDocument();
    await expect(rowOrder(canvas)).toEqual([
      "expense-row-502",
      "expense-row-506",
      "expense-row-505",
      "expense-row-504",
      "expense-row-503",
      "expense-row-501",
    ]);

    const ads = within(canvas.getByTestId("expense-row-501"));
    await expect(ads.getByText("Ads")).toBeInTheDocument();
    await expect(ads.getByText("Shopee ads — week 1")).toBeInTheDocument();
    await expect(ads.getByTestId("expense-amount-501")).toHaveTextContent("Rp 1.500.000");
    // Untouched, it is one line — no "now".
    await expect(ads.queryByTestId("expense-net-501")).toBeNull();
    await expect(within(canvas.getByTestId("expense-row-502")).getByText("Payroll")).toBeInTheDocument();

    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.ADS}`)).toHaveTextContent("Rp 1.500.000");
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.PAYROLL}`)).toHaveTextContent("Rp 4.000.000");
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.OPERATIONAL}`)).toHaveTextContent("Rp 850.000");
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.350.000");

    // A DAY READS SHORT (a-table-date-is-short-and-every-time-is-wib): "5 Nov", the year only when it is not this one —
    // never the RPC's "2026-11-05".
    await expect(canvas.getByTestId("expense-date-502")).toHaveTextContent(/^5 [A-Z][a-z]{2,3}$/);
    await expect(canvas.getByTestId("expense-date-502")).toHaveTextContent(formatDayShort(`${CURRENT_MONTH}-05`));
    await expect(canvas.getByTestId("expenses-table")).not.toHaveTextContent(CURRENT_MONTH);

    // An Owner records.
    await expect(canvas.getByTestId("open-record-cost")).toHaveTextContent("Record Expense");
    await expect(canvas.queryByTestId("expenses-empty")).toBeNull();
  },
};

// THIS MONTH IS JAKARTA'S (a-table-date-is-short-and-every-time-is-wib): the month the page opens on is the business's,
// the same clock the Record dialog pre-fills its day from — never the browser's. Pinned at the boundaries, where a
// browser on UTC would still read last month for the first seven hours.
export const ThisMonthIsJakartas: Story = {
  play: async ({ canvasElement }) => {
    // 1 Dec 00:30 WIB is still 30 Nov 17:30 in UTC — and already December here.
    await expect(thisMonth(new Date("2026-11-30T17:30:00Z"))).toBe("2026-12");
    // A second before midnight WIB it is still November.
    await expect(thisMonth(new Date("2026-11-30T16:59:59Z"))).toBe("2026-11");
    // New Year: 1 Jan 2027 06:59 WIB is 2026 in UTC.
    await expect(thisMonth(new Date("2026-12-31T23:59:00Z"))).toBe("2027-01");

    // The page opens on it, and it is the month of the day the Record dialog pre-fills.
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("expenses-month")).toHaveValue(todayWibDateInput().slice(0, 7));
    await expect(canvas.getByTestId("expenses-month")).toHaveValue(thisMonth());
  },
};

// A team that has recorded nothing — the screen as the e2e first opens it: this month, the table, the empty hint, and
// every card at Rp 0 (a kind with nothing is absent from the totals, and reads as 0 on a card).
export const AnEmptyMonth: Story = {
  beforeEach: asTeam(QUIET_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("expenses-empty", {}, { timeout: 4000 })).toHaveTextContent(
      "No expenses recorded this month.",
    );
    await expect(canvas.getByTestId("expenses-table")).toBeVisible();
    await expect(canvas.getByTestId("expenses-month")).toHaveValue(CURRENT_MONTH);
    await expect(canvas.getByText("Toko Kenanga")).toBeInTheDocument();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 0");
    for (const kind of [ExpenseKind.ADS, ExpenseKind.PAYROLL, ExpenseKind.OPERATIONAL]) {
      await expect(canvas.getByTestId(`expenses-total-kind-${kind}`)).toHaveTextContent("Rp 0");
    }
    await expect(rowOrder(canvas)).toEqual([]);
  },
};

// AN ADJUSTED EXPENSE (every-correction-is-a-signed-adjustment): #503 keeps the 800.000 somebody typed and says it counts
// for 850.000 now; the +50.000 is a row of its own on the same day, muted, badged, signed — and has no actions, because
// a mistaken correction is fixed by correcting the expense again.
export const AnAdjustedExpense: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const expense = within(canvas.getByTestId("expense-row-503"));
    await expect(expense.getByTestId("expense-amount-503")).toHaveTextContent("Rp 800.000");
    await expect(expense.getByTestId("expense-net-503")).toHaveTextContent("now Rp 850.000");
    await expect(expense.queryByTestId("expense-adjustment-503")).toBeNull();

    const correction = within(canvas.getByTestId("expense-row-504"));
    await expect(correction.getByTestId("expense-adjustment-504")).toHaveTextContent("Adjustment");
    await expect(correction.getByText("Operational")).toBeInTheDocument();
    await expect(correction.getByTestId("expense-amount-504")).toHaveTextContent("+Rp 50.000");
    await expect(correction.getByText("The invoice says 850.000")).toBeInTheDocument();
    await expect(correction.queryByTestId("expense-actions-504")).toBeNull();
    // Same day as its expense (an-adjustment-counts-on-the-day-it-fixes).
    await expect(canvas.getByTestId("expense-date-504")).toHaveTextContent(formatDayShort(`${CURRENT_MONTH}-03`));
    await expect(canvas.getByTestId("expense-date-503")).toHaveTextContent(formatDayShort(`${CURRENT_MONTH}-03`));

    // The expense still offers both: correct it again, or cancel what is left.
    await openActions(canvas, "503");
    await expect(screen.getByTestId("expense-adjust-503")).toHaveTextContent("Adjust");
    await expect(screen.getByTestId("expense-cancel-503")).toHaveTextContent("Cancel Expense");
  },
};

// A CANCELLED EXPENSE is an expense whose corrections net it to 0 — both rows stay. Cancel is no longer offered (nothing
// is left to cancel); Adjust still is, so a cancel made by mistake is undone by correcting it back up.
export const ACancelledExpense: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("expense-amount-505")).toHaveTextContent("Rp 200.000");
    await expect(canvas.getByTestId("expense-net-505")).toHaveTextContent("now Rp 0");
    await expect(canvas.getByTestId("expense-adjustment-506")).toBeInTheDocument();
    await expect(canvas.getByTestId("expense-amount-506")).toHaveTextContent("−Rp 200.000");
    await expect(canvas.getByTestId("expense-row-506")).toHaveTextContent("Cancelled");

    await openActions(canvas, "505");
    await expect(screen.queryByTestId("expense-cancel-505")).toBeNull();
  },
};

// THE MONTH IS THE PERIOD, AND THE URL'S (a-lists-filters-live-in-the-url). Last month shows only its own two rows and
// totals; a month nothing was recorded in shows none — which is what makes the filter real rather than decorative.
export const AnotherMonth: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    fireEvent.change(canvas.getByTestId("expenses-month"), { target: { value: LAST_MONTH } });
    await canvas.findByTestId("expense-row-481", {}, { timeout: 4000 });
    await expect(rowOrder(canvas)).toEqual(["expense-row-480", "expense-row-481"]);
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 4.250.000");
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.ADS}`)).toHaveTextContent("Rp 0");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`month=${LAST_MONTH}`));

    fireEvent.change(canvas.getByTestId("expenses-month"), { target: { value: EMPTY_MONTH } });
    await expect(await canvas.findByTestId("expenses-empty", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 0");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`month=${EMPTY_MONTH}`));
  },
};

// The kind narrows the rows AND the totals — the server totals the filtered set, never the page — and lives in the URL.
// An adjustment carries its expense's kind, so the Operational correction comes with it.
export const FilterByKind: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("expenses-kind-filter"));
    const option = await screen.findByTestId(`expenses-kind-filter-${ExpenseKind.OPERATIONAL}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(rowOrder(canvas)).toEqual(["expense-row-504", "expense-row-503"]));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 850.000");
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.PAYROLL}`)).toHaveTextContent("Rp 0");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`kind=${ExpenseKind.OPERATIONAL}`));
  },
};

// RECORD: the dialog's expense lands on this month's list and in its totals.
export const RecordAnExpense: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-record-cost"));
    await userEvent.click(await screen.findByTestId("expense-kind-select"));
    const operational = await screen.findByTestId(`expense-kind-select-${ExpenseKind.OPERATIONAL}`);
    await waitFor(() => expect(operational).toBeVisible());
    await userEvent.click(operational);
    await userEvent.type(screen.getByTestId("expense-amount"), "300000", { delay: 40 });
    await userEvent.click(screen.getByTestId("expense-paid-from"));
    const bca = await screen.findByTestId(`expense-paid-from-option-${BCA_OPERASIONAL}`);
    await waitFor(() => expect(bca).toBeVisible());
    await userEvent.click(bca);
    await userEvent.type(screen.getByTestId("expense-note"), "Water bill", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-cost"));

    await expect((await screen.findAllByText("Expense recorded"))[0]).toBeInTheDocument();
    const row = within(await canvas.findByTestId(`expense-row-${NEW_ID}`, {}, { timeout: 4000 }));
    await expect(row.getByText("Water bill")).toBeInTheDocument();
    await expect(row.getByTestId(`expense-amount-${NEW_ID}`)).toHaveTextContent("Rp 300.000");
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.OPERATIONAL}`)).toHaveTextContent("Rp 1.150.000");
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.650.000");
    await expect(expenseScenario.lastCreate?.kind).toBe(ExpenseKind.OPERATIONAL);
    await expect(expenseScenario.lastCreate?.amount).toBe(300_000n);
  },
};

// ADJUST: the correction is typed, not the new total — 50.000 less. The expense keeps its 800.000, a new adjustment row
// appears, and the totals follow.
export const AdjustAnExpense: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-adjust-503"));
    const dialog = within(await screen.findByTestId("adjust-expense-dialog"));
    await expect(dialog.getByTestId("adjust-expense-now")).toHaveTextContent("counts for Rp 850.000 now");
    await userEvent.type(dialog.getByTestId("adjust-amount"), "50000", { delay: 40 });
    await expect(dialog.getByTestId("adjust-after")).toHaveTextContent("Rp 800.000");
    await userEvent.type(dialog.getByTestId("adjust-note"), "Double-counted the fee", { delay: 20 });
    await userEvent.click(dialog.getByTestId("submit-adjust"));

    await expect((await screen.findAllByText("Adjustment recorded"))[0]).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.300.000"));
    await expect(canvas.getByTestId("expense-amount-503")).toHaveTextContent("Rp 800.000");
    await expect(canvas.queryByTestId("expense-net-503")).toBeNull(); // back to what it was typed as: one line
    await expect(canvas.getByTestId(`expense-amount-${NEW_ID}`)).toHaveTextContent("−Rp 50.000");
    await expect(canvas.getByTestId(`expense-adjustment-${NEW_ID}`)).toBeInTheDocument();
    await expect(expenseScenario.lastAdjust?.amount).toBe(-50_000n);
  },
};

// CANCEL — Batalkan confirms first (it moves a profit figure), then writes minus the whole of what is left: 850.000, its
// net, not its original 800.000. Every row stays: the expense, its first correction, and the cancel.
export const CancelAnExpense: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-cancel-503"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("An adjustment of minus Rp 850.000 is recorded on the same day");
    // The menu closes as the confirm opens — it is not left behind the dialog.
    await menuClosed("503");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect((await screen.findAllByText("Expense cancelled"))[0]).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 5.500.000"));
    await expect(canvas.getByTestId("expense-net-503")).toHaveTextContent("now Rp 0");
    await expect(canvas.getByTestId(`expense-amount-${NEW_ID}`)).toHaveTextContent("−Rp 850.000");
    await expect(canvas.getByTestId(`expense-row-${NEW_ID}`)).toHaveTextContent("Cancelled");
    await expect(canvas.getByTestId("expense-row-503")).toHaveTextContent("Electricity");
    await expect(canvasElement.querySelectorAll('[data-testid^="expense-adjustment-"]')).toHaveLength(3);
    await expect(expenseScenario.lastAdjust?.amount).toBe(-850_000n);
  },
};

// SOMEBODY CORRECTED IT FIRST: the screen still reads 850.000, a colleague has meanwhile taken 100.000 off, and the
// cancel of −850.000 would take it below 0 — the server's floor refuses, and the page says so in a toast. The refusal
// REFETCHES the list (queries.ts): the stale 850.000 that caused it gives way to the 750.000 the server holds, the
// colleague's correction appears, and a second Cancel would now offer the right figure.
export const ACancelRefusedIsSaid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-cancel-503"));
    const dialog = await screen.findByRole("alertdialog");
    someoneElseAdjusts(503n, -100_000n);
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect((await screen.findAllByText("Could not cancel the expense"))[0]).toBeInTheDocument();
    await expect((await screen.findAllByText(/the correction would take the expense below 0/))[0]).toBeInTheDocument();
    await expect(expenseScenario.lastAdjust?.amount).toBe(-850_000n);
    await expect(canvas.queryByTestId(`expense-row-${(FIRST_NEW_EXPENSE_ID + 1n).toString()}`)).toBeNull();

    await waitFor(() => expect(canvas.getByTestId("expense-net-503")).toHaveTextContent("now Rp 750.000"));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.250.000");
    await expect(canvas.getByTestId(`expense-amount-${NEW_ID}`)).toHaveTextContent("−Rp 100.000");

    // After the refused confirm the dialog is gone and the menu is shut — nothing left open behind it.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await menuClosed("503");
    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-cancel-503"));
    const again = await screen.findByRole("alertdialog");
    await expect(again).toHaveTextContent("An adjustment of minus Rp 750.000");
  },
};

// THE SAME REFUSAL FROM ADJUST: the dialog stays open with the server's words, and the figure it shows is refreshed —
// the page hands it the row as the list holds it now, so "counts for" reads 750.000, and reducing by 850.000 is said to
// be below 0 here, before another round trip.
export const AnAdjustRefusedShowsTheFigureNow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-adjust-503"));
    const dialog = within(await screen.findByTestId("adjust-expense-dialog"));
    await userEvent.type(dialog.getByTestId("adjust-amount"), "850000", { delay: 40 });
    someoneElseAdjusts(503n, -100_000n);
    await userEvent.click(dialog.getByTestId("submit-adjust"));

    await expect(await dialog.findByTestId("adjust-form-error")).toHaveTextContent(
      "the correction would take the expense below 0",
    );
    await waitFor(() => expect(dialog.getByTestId("adjust-expense-now")).toHaveTextContent("counts for Rp 750.000 now"));
    await expect(dialog.getByTestId("adjust-below-zero")).toHaveTextContent("It counts for Rp 750.000 now");
    await expect(dialog.getByTestId("submit-adjust")).toBeDisabled();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.250.000");
  },
};

// THE ADMIN TEAM MONITORS READ-ONLY (the-admin-team-monitors-read-only): the month, its rows and totals — and no Record,
// no row actions.
export const AMonitorReadsOnly: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.350.000");
    await expect(canvas.queryByTestId("open-record-cost")).toBeNull();
    await expect(canvasElement.querySelectorAll('[data-testid^="expense-actions-"]')).toHaveLength(0);
  },
};

// Money out is not customer service's business — the list is refused by the server (ExpenseList's policy carries no
// SELLING_CS), and the page shows the refusal rather than an empty month. No expense RPC takes CS (expense.proto), so
// it is offered no Record either — and no empty table or pager sits under the refusal to read as a month with nothing.
export const CustomerServiceIsRefused: Story = {
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("expenses-error", {}, { timeout: 4000 })).toHaveTextContent(
      "expenses are read by the team's Owner and Admin",
    );
    await expect(canvas.queryByTestId("expenses-empty")).toBeNull();
    await expect(canvas.queryByTestId("expenses-totals")).toBeNull();
    await expect(canvas.queryByTestId("open-record-cost")).toBeNull();
    await expect(canvas.queryByTestId("expenses-table")).toBeNull();
    await expect(canvasElement.querySelectorAll('[data-testid^="expense-actions-"]')).toHaveLength(0);
  },
};

// A PHONE GETS ITS OWN DRAWING, not the desktop's five columns squeezed (a design change awaiting the owner's accept):
//   - the header is ONE row — the title, the team, and Record as its icon (the-phone-header-is-one-row,
//     a-phone-header-action-is-an-icon); the month moves to the filter row, beside the kind;
//   - the totals are compact — the month's total on a line, the three kinds under it;
//   - each expense is a BLOCK (a-phone-reads-each-line-as-a-block): the kind and the amount, the day, the note, the
//     corrected net under the amount, the ⋯ at its edge; an adjustment is the same block muted, with no ⋯.
const PHONE = { viewport: { value: "mobile2" } };

/** An element's rendered line count, from its height and line-height — 1 means it did not wrap. */
function lines(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  return Math.round(el.getBoundingClientRect().height / lh);
}

export const Phone: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // One header row: the title and the Record icon share it.
    const title = canvas.getByRole("heading", { name: "Expenses" });
    const record = canvas.getByTestId("open-record-cost");
    await expect(record).toHaveAccessibleName("Record Expense");
    await expect(record).not.toHaveTextContent("Record Expense");
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    await expect(Math.abs(centre(title) - centre(record))).toBeLessThan(8);

    // The month left the header for the filter row, and sits under it.
    const month = canvas.getByTestId("expenses-month");
    await expect(month).toBeVisible();
    await expect(month.getBoundingClientRect().top).toBeGreaterThan(record.getBoundingClientRect().bottom);

    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 6.350.000");
    await expect(rowOrder(canvas)).toHaveLength(6);

    // A block, not a table row — and its amount never wraps "Rp" off its figure, nor its day.
    const payroll = canvas.getByTestId("expense-row-502");
    await expect(payroll.tagName).not.toBe("TR");
    await expect(canvas.queryByRole("table")).toBeNull();
    await expect(lines(canvas.getByTestId("expense-amount-502"))).toBe(1);
    await expect(lines(canvas.getByTestId("expense-date-502"))).toBe(1);
    await expect(canvas.getByTestId("expense-date-502")).toHaveTextContent(formatDayShort(`${CURRENT_MONTH}-05`));
    await expect(within(payroll).getByText("Payroll")).toBeInTheDocument();

    // The corrected expense says what it counts for under its amount; its correction is muted, badged, with no ⋯.
    await expect(canvas.getByTestId("expense-net-503")).toHaveTextContent("now Rp 850.000");
    await expect(canvas.getByTestId("expense-adjustment-504")).toBeVisible();
    await expect(canvas.queryByTestId("expense-actions-504")).toBeNull();
    await expect(canvas.getByTestId("expense-actions-503")).toBeVisible();

    // Nothing runs off the side of the phone.
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth + 1);
  },
};

// A phone block's ⋯ holds the row's two actions, each with its name — and Cancel opens the same confirm.
export const PhoneRowActions: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openActions(canvas, "503");
    await expect(screen.getByTestId("expense-adjust-503")).toHaveTextContent("Adjust");
    await expect(screen.getByTestId("expense-cancel-503")).toHaveTextContent("Cancel Expense");
  },
};

// A phone, a team that recorded nothing: the one-row header, every total Rp 0, the hint — and no blocks.
export const PhoneEmptyMonth: Story = {
  globals: PHONE,
  beforeEach: asTeam(QUIET_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("expenses-empty", {}, { timeout: 4000 })).toHaveTextContent(
      "No expenses recorded this month.",
    );
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent("Rp 0");
    await expect(canvas.getByTestId("open-record-cost")).toBeVisible();
    await expect(rowOrder(canvas)).toEqual([]);
  },
};

// THE LIST NAMES THE PAYING ACCOUNT (an-expense-must-name-the-account-that-paid): its own column, by name — the accounts'
// read, not the id. An adjustment names its expense's account, where it posts (a-correction-follows-the-expenses-account).
export const TheListNamesThePayingAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("expenses-table")).getByRole("columnheader", { name: /Paid from/ })).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("expense-account-501")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("expense-account-503")).toHaveTextContent("ShopeePay Melati");
    await expect(canvas.getByTestId("expense-account-504")).toHaveTextContent("ShopeePay Melati");
    await expect(canvas.getByTestId("expense-account-505")).toHaveTextContent("BCA Operasional");
    await expect(canvas.getByTestId("expense-account-506")).toHaveTextContent("BCA Operasional");
    // An Ads row names its shop under the kind.
    await waitFor(() => expect(canvas.getByTestId("expense-shop-501")).toHaveTextContent("Melati Official"));
  },
};

// The same on a phone: each block names its account on the day's line.
export const TheListNamesThePayingAccountOnAPhone: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(within(canvas.getByTestId("expense-row-501")).getByTestId("expense-account-501")).toHaveTextContent(
        "BCA Operasional",
      ),
    );
    await expect(within(canvas.getByTestId("expense-row-503")).getByTestId("expense-account-503")).toHaveTextContent(
      "ShopeePay Melati",
    );
    await expect(within(canvas.getByTestId("expense-row-502")).getByTestId("expense-account-502")).toHaveTextContent(
      "No account",
    );
    await waitFor(() => expect(canvas.getByTestId("expense-shop-501")).toHaveTextContent("Melati Official"));
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth + 1);
  },
};

// AN OLD EXPENSE — #502, recorded before Paid from — names no account and says so, muted; nothing is guessed for it.
// It also names a shop on a Payroll, from before a shop was for ads only, and keeps showing it.
export const AnOldExpenseHasNoAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("expense-account-502")).toHaveTextContent("No account");
    await expect(canvas.getByTestId("expense-account-502")).toHaveAttribute("data-account-id", "0");
    await waitFor(() => expect(canvas.getByTestId("expense-shop-502")).toHaveTextContent("Melati Store"));
    await expect(canvas.getByTestId("expense-amount-502")).toHaveTextContent("Rp 4.000.000");
  },
};

// CANCEL SAYS WHERE THE MONEY GOES (a-correction-follows-the-expenses-account): #503 was paid from ShopeePay Melati, so
// its Rp 850.000 goes back there. An old expense (#502) names no account: its cancel moves no balance, and says so.
export const CancelSaysWhereTheMoneyGoes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("expense-account-503")).toHaveTextContent("ShopeePay Melati"));

    await openActions(canvas, "502");
    await userEvent.click(screen.getByTestId("expense-cancel-502"));
    const old = await screen.findByRole("alertdialog");
    await expect(old).toHaveTextContent("This expense names no account, so no balance moves.");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await menuClosed("502");

    await openActions(canvas, "503");
    await userEvent.click(screen.getByTestId("expense-cancel-503"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Rp 850.000 goes back to ShopeePay Melati.");
  },
};
