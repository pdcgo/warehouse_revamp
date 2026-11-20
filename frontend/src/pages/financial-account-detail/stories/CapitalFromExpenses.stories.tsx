import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import {
  BCA_OPS_WITH_CAPITAL,
  CAPITAL_LOGS,
  TYPED,
  expenseTypesDecorator,
  withCapitalRows,
} from "../../../features/expense/expenseTypesStoryKit";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { ACCOUNT_DETAIL_META, BCA_OPS, firstRow, loaded, rp } from "./kit";

// ⚠ STORYBOOK-ONLY PROTOTYPE — backlog #99, `prive-and-deposit-on-pengeluaran-are-the-accounts-capital`: THE ACCOUNT'S
// SIDE. A Prive typed on Pengeluaran (#523) is the account's CAPITAL row — the same record as Tarik Modal — so BCA
// Operasional's history shows it as *Capital*, its way *from Expenses #523 · Ani Rahayu*; a Setor Modal made here stays
// *by hand* and shows on Pengeluaran too. Selling team Toko Melati (12), its Admin.
//
//   | story                     | what it pins                                                                       |
//   | ------------------------- | ---------------------------------------------------------------------------------- |
//   | PriveTypedOnExpenses      | the prive row: Capital, −2.000.000, from Expenses #523; the setor row by hand        |
//   | Phone                     | a phone's row opens its detail, which says *from Expenses #523*                     |
//   | CapitalDialogSaysSo       | Setor / Tarik Modal on a selling team's account: one line that it shows on Biaya      |
//   | Live                      | today's page, the prototype not mounted: a capital row says *by hand*, no line       |

const meta = {
  title: "Pages/FinancialAccount/Account/CapitalFromExpenses",
  ...ACCOUNT_DETAIL_META,
  parameters: { ...ACCOUNT_DETAIL_META.parameters, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: (context) => {
    ACCOUNT_DETAIL_META.beforeEach();
    if (context.parameters.live) return undefined;

    return withCapitalRows();
  },
  decorators: [expenseTypesDecorator],
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

    // The Setor Modal made on this page stays a hand row here — and shows on Pengeluaran (ExpenseTypes' Month story).
    await expect(canvas.getByTestId(`account-log-way-${CAPITAL_LOGS.deposit}`)).toHaveTextContent("by hand · Ani Rahayu");
    await expect(firstRow(canvas)).toHaveTextContent("Capital");
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

// SETOR / TARIK MODAL on a selling team's account — one line that the same record shows on Pengeluaran.
export const CapitalDialogSaysSo: Story = {
  name: "Setor / Tarik Modal says it shows on Biaya",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, BCA_OPS_WITH_CAPITAL);

    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    const capital = await screen.findByTestId(`account-capital-${BCA_OPS.id}`);
    await waitFor(() => expect(capital).toBeVisible());
    await userEvent.click(capital);

    const out = await screen.findByTestId("capital-out");
    await waitFor(() => expect(out).toBeVisible());
    await userEvent.click(out);
    await expect(screen.getByTestId("capital-on-expenses-hint")).toHaveTextContent("Also shown on Expenses");
  },
};

// LIVE — today's page: no row from Pengeluaran, a capital row says *by hand*, the dialog has no line.
export const Live: Story = {
  name: "Live · today's account",
  parameters: { live: true },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-log-way-1427")).toHaveTextContent("by hand · Ani Rahayu");
    await expect(canvasElement.querySelector('[data-testid^="account-log-via-expenses-"]')).toBeNull();

    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    const capital = await screen.findByTestId(`account-capital-${BCA_OPS.id}`);
    await waitFor(() => expect(capital).toBeVisible());
    await userEvent.click(capital);
    await screen.findByTestId("capital-out");
    await expect(screen.queryByTestId("capital-on-expenses-hint")).toBeNull();
  },
};
