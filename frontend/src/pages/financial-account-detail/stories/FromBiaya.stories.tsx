import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { BCA_OPS_WITH_CAPITAL, CAPITAL_LOGS, TYPED, withCapitalRows } from "../../../features/expense/expenseTypesStoryKit";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { ACCOUNT_DETAIL_META, firstRow, loaded, rp } from "./kit";

// THE ACCOUNT'S SIDE OF BIAYA'S TYPES — backlog #99 P1, live (prive-and-deposit-on-pengeluaran-are-the-accounts-capital,
// money-in-on-biaya-is-its-own-change-type). A Prive typed on Biaya (#523) is the account's CAPITAL row — the same record
// as Tarik Modal — so BCA Operasional's history shows it as *Capital*, its way *from Expenses #523 · Ani Rahayu*
// (FinancialAccountLog.expense_id); a money in typed on Biaya (#522) is a *Money in* row; a Setor Modal made here stays
// *by hand*. Selling team Toko Melati (12), its Admin; the rows as the expense listener posts them (withCapitalRows).
//
//   | story                     | what it pins                                                                       |
//   | ------------------------- | ---------------------------------------------------------------------------------- |
//   | PriveTypedOnExpenses      | the prive row: Capital, −2.000.000, from Expenses #523; money in; the setor by hand  |
//   | Phone                     | a phone's row opens its detail, which says *from Expenses #523*                     |

const meta = {
  title: "Pages/FinancialAccount/Account/FromBiaya",
  ...ACCOUNT_DETAIL_META,
  parameters: { ...ACCOUNT_DETAIL_META.parameters, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    ACCOUNT_DETAIL_META.beforeEach();
    withCapitalRows();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE PRIVE TYPED ON PENGELUARAN — still *Capital* on the account, never an expense; its way names the expense.
export const PriveTypedOnExpenses: Story = {
  name: "A prive typed on Biaya stays capital",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, BCA_OPS_WITH_CAPITAL);

    const prive = canvas.getByTestId(`account-log-row-${CAPITAL_LOGS.prive}`);
    await expect(prive).toHaveTextContent("Capital");
    await expect(prive).toHaveTextContent(`−${rp(2_000_000)}`);
    await expect(prive).toHaveTextContent(`Prive — Prive November (Expenses #${TYPED.prive})`);
    await expect(canvas.getByTestId(`account-log-via-expenses-${CAPITAL_LOGS.prive}`)).toHaveTextContent(
      `from Expenses #${TYPED.prive} · Ani Rahayu`,
    );

    // A Setor Modal made on this page stays a hand row — no *from Expenses*.
    await expect(canvas.getByTestId(`account-log-way-${CAPITAL_LOGS.deposit}`)).toHaveTextContent("by hand · Ani Rahayu");
    await expect(canvas.queryByTestId(`account-log-via-expenses-${CAPITAL_LOGS.deposit}`)).toBeNull();
    await expect(firstRow(canvas)).toHaveTextContent("Capital");

    // MONEY IN typed on Biaya — its own change type, never a plus-sign expense (money-in-on-biaya-is-its-own-change-type).
    const moneyIn = canvas.getByTestId(`account-log-row-${CAPITAL_LOGS.moneyIn}`);
    await expect(moneyIn).toHaveTextContent("Money in");
    await expect(moneyIn).toHaveTextContent(`+${rp(350_000)}`);
    await expect(canvas.queryByTestId(`account-log-via-expenses-${CAPITAL_LOGS.moneyIn}`)).toBeNull();
  },
};

// A PHONE — the row is the date, its type and the money; a tap opens it, and the detail says where it came from.
export const Phone: Story = {
  name: "Phone · the row's detail",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, BCA_OPS_WITH_CAPITAL);

    await userEvent.click(canvas.getByTestId(`account-log-row-${CAPITAL_LOGS.prive}`));
    const detail = await screen.findByTestId("account-log-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(within(detail).getByTestId("account-log-detail-via-expenses")).toHaveTextContent(
      `from Expenses #${TYPED.prive} · Ani Rahayu`,
    );
  },
};
