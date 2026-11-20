import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, besideTheOpenSidebar, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { EXPENSE_TEAM } from "../../../../.storybook/expenseFixtures";
import { MONTH, TYPED, expenseTypesDecorator } from "../../../features/expense/expenseTypesStoryKit";
import { EXPENSE_TYPES } from "../../../features/expense/expenseTypesPrototype";
import { PHONE_VIEWPORTS, fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import i18n from "../../../i18n/config";
import { formatRupiah } from "../../../lib/money";
import { ExpensesPage } from "../index";

// ⚠ STORYBOOK-ONLY PROTOTYPE — backlog #99, `expense-types-sit-under-groups` and
// `prive-and-deposit-on-pengeluaran-are-the-accounts-capital`: PENGELUARAN'S MONTH. Toko Melati (12), its Owner, this
// month (expenseTypesStoryKit.tsx): the old rows keep their group and no type; the typed rows read *Group › Type*; the
// totals show each group with its types under it, and a top line that keeps spending apart from money in and capital.
//
//   | story                    | what it pins                                                                             |
//   | ------------------------ | ---------------------------------------------------------------------------------------- |
//   | Month                    | the top line (Spending · Money in · Capital · Month total), the four groups and their    |
//   |                          | types, a row's Group › Type, Modal and In marks, a Setor Modal made on the account page  |
//   | MonthBesideTheSidebar    | the same at the app's width — 1366 px beside the open sidebar                            |
//   | Phone                    | the compact card: the total, the three figures, the groups folded — a tap opens one      |
//   | FilterAGroup             | All Operasional: its rows only, the totals narrowed, the URL's kind                       |
//   | FilterOneType            | Listrik: its one row, the totals narrowed to it, the trigger reads Group › Type           |
//   | OldRowsKeepTheirGroup    | a row recorded before the types: its group alone, counted as *No type* under it          |
//   | CancelATypedExpense      | Batalkan on a typed row: its correction keeps the type, the line and the total follow    |
//   | EveryTypeHasItsWords     | every type's words in en and id (a key built at run time — keys.test cannot see it)      |
//   | Live                     | today's page, the prototype not mounted: the kind card, the kind filter, no types        |

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

const PHONE = { viewport: { value: "phone390" } };

const meta = {
  title: "Pages/Expenses/ExpensesPage/ExpenseTypes",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(EXPENSE_TEAM)();
    asRole(Role.SELLING_OWNER)();
  },
  decorators: [expenseTypesDecorator],
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
    // A Setor Modal made on the account page shows here — the same one record.
    await expect(canvas.getByTestId(`expense-origin-${TYPED.deposit}`)).toHaveTextContent("Recorded on the account page");
    await expect(canvas.queryByTestId(`expense-origin-${TYPED.prive}`)).toBeNull();
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

    // Back to everything.
    await pickFilter(canvas, "expenses-kind-filter-any");
    await waitFor(() => expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total)));
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

// LIVE — today's page, the prototype not mounted: the kind card (three kinds and the total), the kind filter, no types.
export const Live: Story = {
  name: "Live · today's page",
  parameters: { live: true },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "expense-row-502");

    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(6_350_000));
    await expect(canvas.getByTestId(`expenses-total-kind-${ExpenseKind.ADS}`)).toHaveTextContent(rp(1_500_000));
    await expect(canvas.queryByTestId("expenses-total-spending")).toBeNull();
    await expect(canvas.queryByTestId(`expense-type-502`)).toBeNull();
    await expect(canvas.queryByTestId(`expense-row-${TYPED.prive}`)).toBeNull();
    await expect(within(canvas.getByTestId("expense-row-501")).getByText("Ads")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("expenses-kind-filter"));
    await waitFor(() => expect(screen.getByTestId(`expenses-kind-filter-${ExpenseKind.STOCK_LOSS}`)).toBeVisible());
    await expect(screen.queryByTestId("expenses-kind-filter-type-electricity")).toBeNull();
    await userEvent.keyboard("{Escape}");
  },
};
