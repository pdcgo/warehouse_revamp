import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { create } from "@bufbuild/protobuf";
import { Stack } from "@chakra-ui/react";

import { ExpenseKind, ExpenseTotalsSchema } from "../../../gen/warehouse/expense/v1/expense_pb";
import { LiabilityDailyTotalsSchema, LiabilitySourceType } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import type { StatementRow } from "../queries";
import { StatementSummary } from "./StatementSummary";
import { StatementTable } from "./StatementTable";

// THE WAREHOUSE STATEMENT'S WORDS — the decided ones, in both languages.
//
// The page itself is deferred (the-daily-report-is-deferred): its own story file is `!test`, kept previewable and not
// run. These stories render its two parts straight from props, so the WORDS stay pinned while the page waits:
//
//   Handling fees · Fee penanganan  →  Order fees · Biaya pesanan
//       the business word is `order_fee` (the-order-fee-posts-at-creation-and-reverses-on-cancel,
//       the-ledger-speaks-the-business-words)
//   COD                             →  Courier COD · Ongkir COD
//       the warehouse's own word for the courier's money, as on its restock screens
//       (the-warehouse-statement-says-ongkir-cod, the-warehouse-sees-the-cod-it-paid)
//
// The courier column sums the three ledger types Team Balance already names as the courier's (a restock's, a return's,
// a transfer's — `courierAsks`), the same money Team Balance's ledger shows as *Biaya kurir …* rows.

const ROW: StatementRow = {
  bucket: "2026-11-10",
  income: 30_000,
  orders: 0,
  revenue: 0,
  cogs: 0,
  shippingCost: 0,
  unknownCostOrders: 0,
  feeEntries: 3,
  codFees: 15_000,
  expenses: 5_000,
  stockLoss: 0,
  otherExpenses: 5_000,
  expenseEntries: 1,
  profit: 25_000,
  running: 25_000,
  active: true,
};

const LIABILITY = create(LiabilityDailyTotalsSchema, {
  net: 45_000,
  bySource: {
    [LiabilitySourceType.ORDER_FEE]: 30_000,
    [LiabilitySourceType.INCIDENTAL_FEE]: 10_000,
    [LiabilitySourceType.TRANSFER_FEE]: 5_000,
  },
});

const EXPENSES = create(ExpenseTotalsSchema, { total: 5_000, byKind: { [ExpenseKind.OPERATIONAL]: 5_000 } });

function WarehouseStatement() {
  return (
    <Stack gap="section">
      <StatementSummary
        mode="warehouse"
        grain="day"
        income={30_000}
        liability={LIABILITY}
        expenses={EXPENSES}
        buckets={1}
        loading={false}
      />
      <StatementTable mode="warehouse" grain="day" rows={[ROW]} income={30_000} liability={LIABILITY} expenses={EXPENSES} />
    </Stack>
  );
}

const meta = {
  title: "Pages/Statements/DailyStatementPage/Words",
  component: WarehouseStatement,
} satisfies Meta<typeof WarehouseStatement>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The headers of the statement's table, as a reader sees them. */
function headers(canvasElement: HTMLElement): string[] {
  return [...within(canvasElement).getByTestId("statement-table").querySelectorAll("thead th")].map(
    (th) => th.textContent ?? "",
  );
}

// The income is the ORDER FEES the warehouse charged; what the couriers asked at its door is its COURIER CHARGES, owed
// back and never income. Neither old word is left on the screen.
export const TheStatementSpeaksTheDecidedWords: Story = {
  name: "The statement speaks the decided words",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByTestId("statement-summary");

    await expect(summary).toHaveTextContent("Order fees charged in this period");
    await expect(canvas.getByTestId("statement-cod-notice")).toHaveTextContent(
      `${formatRupiah(15_000)} in Courier COD is owed back to you but is NOT counted as income`,
    );
    await expect(headers(canvasElement)).toContain("Courier COD");
    await expect(canvas.getByTestId("statement-footer")).toHaveTextContent(formatRupiah(15_000));

    await expect(canvasElement).not.toHaveTextContent(/handling/i);
    await expect(canvasElement).not.toHaveTextContent(/\bcourier charges\b|biaya kurir/i);
  },
};

// …and in Indonesian: Biaya pesanan, Ongkir COD — the words the warehouse's restock screens already use.
export const TheStatementSpeaksTheDecidedWordsInIndonesian: Story = {
  name: "The statement speaks the decided words (Indonesian)",
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByTestId("statement-summary");

    await expect(summary).toHaveTextContent("Biaya pesanan pada periode ini");
    await expect(canvas.getByTestId("statement-cod-notice")).toHaveTextContent(
      `${formatRupiah(15_000)} ongkir COD masih menjadi hak Anda tetapi TIDAK dihitung sebagai pemasukan`,
    );
    await expect(headers(canvasElement)).toContain("Ongkir COD");

    await expect(canvasElement).not.toHaveTextContent(/penanganan/i);
    await expect(canvasElement).not.toHaveTextContent(/\bcourier charges\b|biaya kurir/i);
  },
};
