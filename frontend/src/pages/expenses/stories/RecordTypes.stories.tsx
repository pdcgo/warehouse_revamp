import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { BCA_OPERASIONAL, EXPENSE_TEAM } from "../../../../.storybook/expenseFixtures";
import { MONTH, expenseTypesDecorator } from "../../../features/expense/expenseTypesStoryKit";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../../lib/money";
import { ExpensesPage } from "../index";

// ⚠ STORYBOOK-ONLY PROTOTYPE — backlog #99: THE RECORD DIALOG, opened from Pengeluaran (so the month behind it moves
// when a row is saved). The picker lists the types under their group's heading; the amount stays positive and the type
// says the direction — a badge under the picker, *Masuk ke* for the account on money in; Prive and Setoran modal say
// they are the account's capital row, the same record as Setor / Tarik Modal, and pick among every account.
//
//   | story                 | what it pins                                                                          |
//   | --------------------- | ------------------------------------------------------------------------------------- |
//   | PickerIsGrouped       | four headings, each type under its group; money in and capital carry their marks      |
//   | PhonePicker           | the same picker on a 390 px phone                                                     |
//   | MoneyIn               | Piutang luar diterima: the In badge and its line, the account field *Received into*   |
//   | PriveIsCapital        | Prive: the capital line, *Taken from*, and every account offered (BCA Gaji too)        |
//   | RecordADeposit        | a Setoran modal saved: its row with Capital and In, Capital and the month total lower  |
//   | OnlyMarketplaceAdsNamesAShop | Konten · endorse sits under Iklan and names no shop; Iklan marketplace needs one |
//   | Live                  | today's dialog, the prototype not mounted: the kind picker, nothing new               |

const Routed = routedPage([{ path: "/expenses", element: <ExpensesPage /> }], "/expenses");

const meta = {
  title: "Pages/Expenses/ExpensesPage/RecordTypes",
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

async function openRecord(canvasElement: HTMLElement, first = "expenses-total-spending") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  await userEvent.click(canvas.getByTestId("open-record-cost"));
  await screen.findByTestId("submit-cost");
  return canvas;
}

async function openPicker() {
  await userEvent.click(screen.getByTestId("expense-type-select"));
  await waitFor(() => expect(screen.getByTestId("expense-type-select-electricity")).toBeVisible());
}

async function pickType(key: string) {
  await openPicker();
  await userEvent.click(screen.getByTestId(`expense-type-select-${key}`));
  await waitFor(() => expect(screen.getByTestId("expense-direction")).toBeInTheDocument());
}

/** The account field's label — the Field.Label holding the paid-from picker. */
const accountLabel = () => screen.getByTestId("expense-paid-from").closest("[data-scope=field]")!.querySelector("label")!;

// THE PICKER — the four groups, each type under its own; money in says *In*, the owner's capital says *Capital*.
export const PickerIsGrouped: Story = {
  name: "Picker · grouped",
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement);
    await openPicker();

    // By the DOM, not by role: the open dialog hides everything outside it from the accessibility tree, the portalled
    // list included.
    const items = (group: ExpenseKind) =>
      Array.from(screen.getByTestId(`expense-type-select-group-${group}`).querySelectorAll<HTMLElement>("[role=option]")).map(
        (o) => o.dataset.testid?.replace("expense-type-select-", ""),
      );
    await expect(items(ExpenseKind.ADS)).toEqual(["adsMarketplace", "contentEndorse"]);
    await expect(items(ExpenseKind.PAYROLL)).toEqual(["basicSalary", "bonus", "contributions"]);
    await expect(items(ExpenseKind.OPERATIONAL)).toEqual([
      "electricity",
      "internet",
      "kitchen",
      "tools",
      "equipment",
      "bankFee",
      "discrepancy",
    ]);
    await expect(items(ExpenseKind.OTHER)).toEqual([
      "outsideDebtPaid",
      "outsideReceivableReceived",
      "prive",
      "capitalDeposit",
      "otherOut",
      "otherIn",
    ]);
    await expect(screen.getByTestId(`expense-type-select-group-${ExpenseKind.OPERATIONAL}`)).toHaveTextContent(/^Operational/);
    await expect(screen.getByTestId("expense-type-select-otherIn")).toHaveTextContent("In");
    await expect(screen.getByTestId("expense-type-select-prive")).toHaveTextContent("Capital");
    await expect(screen.getByTestId("expense-type-select-capitalDeposit")).toHaveTextContent("CapitalIn");
    await expect(screen.getByTestId("expense-type-select-electricity")).toHaveTextContent(/^Electricity$/);
  },
};

// ON A PHONE — the same picker, each option a thumb's height.
export const PhonePicker: Story = {
  name: "Phone · picker",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await openPicker();
  },
};

// MONEY IN — the amount stays positive; the badge says *Money in*, the account field *Received into*.
export const MoneyIn: Story = {
  name: "Money in · received into",
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement);
    await pickType("outsideReceivableReceived");

    await expect(screen.getByTestId("expense-type-select")).toHaveTextContent("Other › Outside receivable received");
    const direction = screen.getByTestId("expense-direction");
    await expect(direction).toHaveAttribute("data-direction", "in");
    await expect(direction).toHaveTextContent("Money in");
    await expect(direction).toHaveTextContent("lowers the month's total");
    await expect(accountLabel()).toHaveTextContent("Received into");
    await expect(screen.queryByTestId("expense-capital-line")).toBeNull();
  },
};

// PRIVE — the account's capital row, the same record as Tarik Modal; taken from ANY of the team's accounts.
export const PriveIsCapital: Story = {
  name: "Prive · the account's capital",
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement);
    await pickType("prive");

    await expect(screen.getByTestId("expense-direction")).toHaveAttribute("data-direction", "out");
    await expect(screen.getByTestId("expense-capital-line")).toHaveTextContent("the same record as Withdraw Capital");
    await expect(accountLabel()).toHaveTextContent("Taken from");

    // Every active account of the team, not only the operational ones — as Setor / Tarik Modal on the account page.
    await userEvent.click(screen.getByTestId("expense-paid-from"));
    const gaji = await screen.findByTestId("expense-paid-from-option-1302");
    await waitFor(() => expect(gaji).toBeVisible());
    await userEvent.click(gaji);
    await waitFor(() => expect(screen.getByTestId("expense-paid-from")).toHaveTextContent("BCA Gaji"));
  },
};

// A SETORAN MODAL SAVED — its row reads Other › Deposit with Capital and In; Capital and the month total go down by it.
export const RecordADeposit: Story = {
  name: "Record · a deposit lowers the total",
  play: async ({ canvasElement }) => {
    const canvas = await openRecord(canvasElement);
    await pickType("capitalDeposit");

    await userEvent.type(screen.getByTestId("expense-amount"), "500000", { delay: 20 });
    await userEvent.click(screen.getByTestId("expense-paid-from"));
    const option = await screen.findByTestId(`expense-paid-from-option-${BCA_OPERASIONAL}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(screen.getByTestId("submit-cost")).toBeEnabled());
    await userEvent.click(screen.getByTestId("submit-cost"));

    await expect((await screen.findAllByText("Expense recorded"))[0]).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("expense-type-600")).toHaveTextContent("Other › Deposit · owner adds capital"));
    await expect(canvas.getByTestId("expense-amount-600")).toHaveTextContent(rp(500_000));
    await expect(canvas.getByTestId("expense-mark-600-capital")).toBeInTheDocument();
    await expect(canvas.getByTestId("expense-mark-600-in")).toBeInTheDocument();
    await expect(canvas.getByTestId("expenses-total-capital")).toHaveTextContent(rp(MONTH.capital - 500_000));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(rp(MONTH.total - 500_000));
    // Spending does not move — capital is never an expense.
    await expect(canvas.getByTestId("expenses-total-spending")).toHaveTextContent(rp(MONTH.spending));
  },
};

// THE SHOP IS THE IKLAN MARKETPLACE TYPE'S — Konten · endorse sits under Iklan and names none (an-expense-names-a-shop-only-for-ads).
export const OnlyMarketplaceAdsNamesAShop: Story = {
  name: "Only marketplace ads names a shop",
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement);

    await pickType("contentEndorse");
    await expect(screen.getByTestId("expense-type-select")).toHaveTextContent("Ads › Content · endorsement");
    await expect(screen.queryByTestId("expense-shop-field")).toBeNull();

    await pickType("adsMarketplace");
    await expect(screen.getByTestId("expense-shop-field")).toBeInTheDocument();
    await expect(screen.getByTestId("expense-form-missing-shop")).toBeInTheDocument();
  },
};

// LIVE — today's dialog, the prototype not mounted: the kind picker, no direction, the account field as it was.
export const Live: Story = {
  name: "Live · today's dialog",
  parameters: { live: true },
  play: async ({ canvasElement }) => {
    await openRecord(canvasElement, "expenses-total");

    await expect(screen.getByTestId("expense-kind-select")).toBeInTheDocument();
    await expect(screen.queryByTestId("expense-type-select")).toBeNull();
    await expect(screen.queryByTestId("expense-direction")).toBeNull();
    await expect(accountLabel()).toHaveTextContent("Paid from");
  },
};
