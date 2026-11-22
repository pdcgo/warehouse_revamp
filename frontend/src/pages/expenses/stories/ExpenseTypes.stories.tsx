import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, besideTheOpenSidebar, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { EXPENSE_TEAM } from "../../../../.storybook/expenseFixtures";
import { MONTH, TYPED, withTypedExpenses } from "../../../features/expense/expenseTypesStoryKit";
import { EXPENSE_TYPES } from "../../../features/expense/expenseTypes";
import { PHONE_VIEWPORTS, fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";
import { ExpenseKind, ExpenseType } from "../../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import i18n from "../../../i18n/config";
import { formatRupiah } from "../../../lib/money";
import { ExpensesPage } from "../index";

// BIAYA'S MONTH WITH THE TYPES — backlog #99 P1, live (the-expense-types-prototype-is-accepted,
// expense-types-sit-under-groups, prive-and-deposit-on-pengeluaran-are-the-accounts-capital,
// money-in-on-biaya-is-its-own-change-type), against the real expense stub. Toko Melati (12), its Owner, this month
// (expenseTypesStoryKit.tsx): the old rows keep their group and no type; the typed rows read *Group › Type*; the card
// shows each group with its types under it, and a top line that keeps spending apart from money in and capital — every
// figure the server's (ExpenseList.totals), never summed on the screen.
//
//   | story                    | what it pins                                                                             |
//   | ------------------------ | ---------------------------------------------------------------------------------------- |
//   | Month                    | the top line (Spending · Money in · Capital · Month total), the four groups and their    |
//   |                          | types, a row's Group › Type, Modal and In marks                                          |
//   | MonthBesideTheSidebar    | the same at the app's width — 1366 px beside the open sidebar                            |
//   | Phone                    | the compact card: the total, the three figures, the groups folded — a tap opens one      |
//   | FilterAGroup             | All Operasional: its rows only, the totals narrowed, the URL's kind                       |
//   | FilterOneType            | Listrik: its one row, the totals narrowed to it, the trigger reads Group › Type, ?type=  |
//   | AnOldKindLinkOpensTheGroup | `/expenses?kind=3` (a link from before the types): All Operasional                     |
//   | ATypeLinkOpensTheType    | `/expenses?kind=3&type=…`: Listrik, as picked                                            |
//   | OldRowsKeepTheirGroup    | a row recorded before the types: its group alone, counted as *No type* under it          |
//   | CancelATypedExpense      | Batalkan on a typed row: its correction keeps the type, the line and the total follow    |
//   | FromTheAccountPage       | the Setoran modal made on the account page: *Recorded on the account page*; its Batalkan  |
//   |                          | is made here (no line), Modal and the month total follow                                 |
//   | EveryTypeHasItsWords     | every type's words in en and id (a key built at run time — keys.test cannot see it)      |

const Routed = routedPage(
  [
    {
      path: "/expenses",
      element: (
        <>
          <ExpensesPage />
          <LocationProbe hidden />
        </>
      ),
    },
  ],
  "/expenses",
);

const routedAt = (path: string) =>
  routedPage(
    [
      {
        path: "/expenses",
        element: (
          <>
            <ExpensesPage />
            <LocationProbe hidden />
          </>
        ),
      },
    ],
    path,
  );

const PHONE = { viewport: { value: "phone390" } };

const meta = {
  title: "Pages/Expenses/ExpensesPage/ExpenseTypes",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(EXPENSE_TEAM)();
    asRole(Role.SELLING_OWNER)();
    withTypedExpenses();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rp = (n: number) => formatRupiah(n);

async function loaded(canvasElement: HTMLElement, first = `expense-row-${TYPED.prive}`) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  return canvas;
}

/** Pick an option of the filter — it portals and animates in. */
async function pickFilter(canvas: ReturnType<typeof within>, optionId: string) {
  await userEvent.click(canvas.getByTestId("expenses-kind-filter"));
  const option = await screen.findByTestId(optionId);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function theMonth(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);

  // THE TOP LINE — spending apart from money in and capital; the month total moves with all three (givens 17–22).
  await expect(canvas.getByTestId("expenses-total-spending")).toHaveTextContent(rp(MONTH.spending));
  await expect(canvas.getByTestId("expenses-total-money-in")).toHaveTextContent(rp(-MONTH.moneyIn));
  await expect(canvas.getByTestId("expenses-total-capital")).toHaveTextContent(rp(MONTH.capital));
  await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total));

  // EACH GROUP, AND ITS TYPES UNDER IT (given 28: each type's total shown).
  await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.ADS}`)).toHaveTextContent(rp(MONTH.ads));
  await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.PAYROLL}`)).toHaveTextContent(rp(MONTH.payroll));
  await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.OPERATIONAL}`)).toHaveTextContent(rp(MONTH.operational));
  await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.OTHER}`)).toHaveTextContent(rp(MONTH.other));

  return canvas;
}

// THE MONTH — the top line, the groups with their types, each row's Group › Type and its marks.
export const Month: Story = {
  name: "Month · groups with their types",
  play: async ({ canvasElement }) => {
    const canvas = await theMonth(canvasElement);

    const operational = within(canvas.getByTestId(`expenses-group-${ExpenseKind.OPERATIONAL}`));
    await expect(operational.getByTestId("expenses-total-type-electricity")).toHaveTextContent(`Electricity${rp(255_000)}`);
    await expect(operational.getByTestId("expenses-total-type-discrepancy")).toHaveTextContent("Discrepancy · unrecorded transaction");
    // The rows from before the types sit under their group as *No type*.
    await expect(operational.getByTestId(`expenses-total-type-none-${ExpenseKind.OPERATIONAL}`)).toHaveTextContent(`No type${rp(850_000)}`);
    const other = within(canvas.getByTestId(`expenses-group-${ExpenseKind.OTHER}`));
    // Money in lowers its type's and its group's figure; capital carries its mark.
    await expect(other.getByTestId("expenses-total-type-outsideReceivableReceived")).toHaveTextContent(rp(-350_000));
    await expect(other.getByTestId("expenses-total-type-prive")).toHaveTextContent(`Capital${rp(2_000_000)}`);
    await expect(other.getByTestId("expenses-total-type-capitalDeposit")).toHaveTextContent(rp(-1_000_000));
    // A cancelled old Other nets to nothing — no line for it.
    await expect(other.queryByTestId(`expenses-total-type-none-${ExpenseKind.OTHER}`)).toBeNull();

    // THE ROWS — Group › Type; the amount stays positive, the type says the direction.
    await expect(canvas.getByTestId(`expense-type-${TYPED.electricity}`)).toHaveTextContent("Operational › Electricity");
    await expect(canvas.getByTestId(`expense-amount-${TYPED.receivable}`)).toHaveTextContent(rp(350_000));
    await expect(canvas.getByTestId(`expense-mark-${TYPED.receivable}-in`)).toHaveTextContent("In");
    await expect(canvas.getByTestId(`expense-mark-${TYPED.prive}-capital`)).toHaveTextContent("Capital");
    await expect(canvas.getByTestId(`expense-mark-${TYPED.deposit}-capital`)).toBeInTheDocument();
    await expect(canvas.getByTestId(`expense-mark-${TYPED.deposit}-in`)).toBeInTheDocument();
    // An ordinary cost carries no mark.
    await expect(canvas.queryByTestId(`expense-mark-${TYPED.electricity}-capital`)).toBeNull();
    // Capital's second door: the Setoran modal made with Setor Modal on the account page says so; nothing else does.
    await expect(canvas.getByTestId(`expense-origin-${TYPED.deposit}`)).toHaveTextContent("Recorded on the account page");
    await expect(canvasElement.querySelectorAll('[data-testid^="expense-origin-"]')).toHaveLength(1);
    // The shop stays under the Iklan marketplace type, as under Ads today.
    await expect(canvas.getByTestId(`expense-shop-${TYPED.adsMarketplace}`)).toBeInTheDocument();
  },
};

// AT THE APP'S WIDTH — the page beside the open sidebar, as DesktopLayout draws it; nothing runs past the card.
export const MonthBesideTheSidebar: Story = {
  name: "Month · beside the sidebar",
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await theMonth(canvasElement);
    const card = canvas.getByTestId("expenses-totals");
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  },
};

// A PHONE — the total first, the three figures three to a row, the groups folded; a tap opens one.
export const Phone: Story = {
  name: "Phone 390",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await theMonth(canvasElement);
    await expect(window.innerWidth).toBe(390);

    const line = canvas.getByTestId("expenses-total-type-electricity");
    await expect(line).not.toBeVisible();
    await userEvent.click(canvas.getByTestId(`expenses-group-toggle-${ExpenseKind.OPERATIONAL}`));
    await waitFor(() => expect(line).toBeVisible());

    await expect(canvas.getByTestId(`expense-type-${TYPED.prive}`)).toHaveTextContent("Other › Prive · owner takes capital");
    await fitsTheScreen(canvasElement);
  },
};

// A GROUP — *All Operasional*: its rows only (old and typed), the totals narrowed to it, the kind in the URL.
export const FilterAGroup: Story = {
  name: "Filter · a group",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickFilter(canvas, `expenses-kind-filter-${ExpenseKind.OPERATIONAL}`);

    await waitFor(() => expect(canvas.queryByTestId(`expense-row-${TYPED.prive}`)).toBeNull());
    await expect(canvas.getByTestId(`expense-row-${TYPED.electricity}`)).toBeInTheDocument();
    await expect(canvas.getByTestId("expense-row-503")).toBeInTheDocument();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.operational));
    await expect(canvas.getByTestId("expenses-kind-filter")).toHaveTextContent("All Operational");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`kind=${ExpenseKind.OPERATIONAL}`));
  },
};

// ONE TYPE — *Listrik*: its one row, the totals narrowed to it, the trigger reads Group › Type.
export const FilterOneType: Story = {
  name: "Filter · one type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickFilter(canvas, "expenses-kind-filter-type-electricity");

    await waitFor(() => expect(canvas.queryByTestId("expense-row-503")).toBeNull());
    const rows = within(canvas.getByTestId("expenses-table")).queryAllByTestId(/^expense-row-\d+$/);
    await expect(rows.map((r) => r.dataset.testid)).toEqual([`expense-row-${TYPED.electricity}`]);
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(255_000));
    await expect(canvas.getByTestId("expenses-kind-filter")).toHaveTextContent("Operational › Electricity");
    await waitFor(() =>
      expect(canvas.getByTestId("location-search")).toHaveTextContent(`type=${ExpenseType.ELECTRICITY}`),
    );

    // Back to everything.
    await pickFilter(canvas, "expenses-kind-filter-any");
    await waitFor(() => expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total)));
  },
};

// AN OLD `?kind=` LINK — from before the types — still opens the whole group.
export const AnOldKindLinkOpensTheGroup: Story = {
  name: "Filter · an old kind link",
  render: () => {
    const At = routedAt(`/expenses?kind=${ExpenseKind.OPERATIONAL}`);
    return <At />;
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, `expense-row-${TYPED.electricity}`);

    await expect(canvas.getByTestId("expenses-kind-filter")).toHaveTextContent("All Operational");
    await expect(canvas.getByTestId("expense-row-503")).toBeInTheDocument();
    await expect(canvas.queryByTestId(`expense-row-${TYPED.prive}`)).toBeNull();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.operational));
  },
};

// A TYPE LINK — `?kind=3&type=…` opens the one type, as picked.
export const ATypeLinkOpensTheType: Story = {
  name: "Filter · a type link",
  render: () => {
    const At = routedAt(`/expenses?kind=${ExpenseKind.OPERATIONAL}&type=${ExpenseType.ELECTRICITY}`);
    return <At />;
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, `expense-row-${TYPED.electricity}`);

    await expect(canvas.getByTestId("expenses-kind-filter")).toHaveTextContent("Operational › Electricity");
    await expect(canvas.queryByTestId("expense-row-503")).toBeNull();
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(255_000));
  },
};

// A ROW RECORDED BEFORE THE TYPES keeps its group and no type — no guessed backfill.
export const OldRowsKeepTheirGroup: Story = {
  name: "Old rows keep their group",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("expense-type-502")).toHaveTextContent(/^Payroll$/);
    const payroll = within(canvas.getByTestId(`expenses-group-${ExpenseKind.PAYROLL}`));
    await expect(payroll.getByTestId(`expenses-total-type-none-${ExpenseKind.PAYROLL}`)).toHaveTextContent(rp(4_000_000));
    await expect(payroll.getByTestId("expenses-total-type-bonus")).toHaveTextContent(rp(600_000));
    // A correction of an old row keeps its group too.
    await expect(canvas.getByTestId("expense-type-504")).toHaveTextContent(/^Operational$/);
  },
};

// BATALKAN ON A TYPED ROW — the correction keeps the type, so the type's line, its group and the total follow.
export const CancelATypedExpense: Story = {
  name: "Cancel a typed expense",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`expense-actions-${TYPED.bonus}`));
    const cancel = await screen.findByTestId(`expense-cancel-${TYPED.bonus}`);
    await waitFor(() => expect(cancel).toBeVisible());
    await userEvent.click(cancel);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId(`expense-net-${TYPED.bonus}`)).toHaveTextContent(`now ${rp(0)}`));
    await expect(canvas.queryByTestId("expenses-total-type-bonus")).toBeNull();
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.PAYROLL}`)).toHaveTextContent(rp(MONTH.payroll - 600_000));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total - 600_000));
    // The correction row reads its expense's type.
    await expect(canvas.getByTestId("expense-type-600")).toHaveTextContent("Payroll › Bonus");
  },
};

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital): the Setoran modal #524 was made with
// Setor Modal on BCA Operasional's page — the same one record, *Recorded on the account page*; the Prive typed here says
// nothing. Batalkan is Biaya's ordinary correction: made here, so its row carries no line; Modal and the month's total
// go back up by the setoran (given 19, undone).
export const FromTheAccountPage: Story = {
  name: "From the account page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`expense-origin-${TYPED.deposit}`)).toHaveTextContent("Recorded on the account page");
    await expect(canvas.queryByTestId(`expense-origin-${TYPED.prive}`)).toBeNull();
    await expect(i18n.getFixedT("id")("expenses.types.fromAccountPage")).toBe("Dicatat di halaman akun");

    await userEvent.click(canvas.getByTestId(`expense-actions-${TYPED.deposit}`));
    const cancel = await screen.findByTestId(`expense-cancel-${TYPED.deposit}`);
    await waitFor(() => expect(cancel).toBeVisible());
    await userEvent.click(cancel);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId(`expense-net-${TYPED.deposit}`)).toHaveTextContent(`now ${rp(0)}`));
    await expect(canvas.getByTestId("expenses-total-capital")).toHaveTextContent(rp(MONTH.capital + 1_000_000));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total + 1_000_000));
    // The correction (#600) reads its expense's type and was made on Biaya — no line; the expense keeps its own.
    await expect(canvas.getByTestId("expense-type-600")).toHaveTextContent("Other › Deposit · owner adds capital");
    await expect(canvas.queryByTestId("expense-origin-600")).toBeNull();
    await expect(canvas.getByTestId(`expense-origin-${TYPED.deposit}`)).toBeInTheDocument();
  },
};

// THE WORDS — every type's, in both languages. The labels are read by a key built at run time, which keys.test.ts does
// not see, so this is the check that a type never shows its key.
export const EveryTypeHasItsWords: Story = {
  name: "Every type has its words",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    for (const lng of ["en", "id"]) {
      const t = i18n.getFixedT(lng);
      for (const d of EXPENSE_TYPES) {
        const key = `expenses.types.type.${d.key}`;
        await expect(i18n.exists(key, { lng }), `${lng}: ${key}`).toBe(true);
        await expect(t(key)).not.toBe(key);
      }
    }
  },
};
