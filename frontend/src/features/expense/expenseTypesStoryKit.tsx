import {
  BCA_OPERASIONAL,
  CURRENT_MONTH,
  EXPENSE_TEAM,
  type ExpenseFixture,
  SHOPEEPAY_MELATI,
} from "../../../.storybook/expenseFixtures";
import { addExpensesForStory } from "../../../.storybook/expenseStub";
import { postLogForStory } from "../../../.storybook/financialAccountStub";
import { ExpenseOrigin } from "../../gen/warehouse/expense/v1/expense_pb";
import { FinancialAccountChangeType as T } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { todayWibDateInput } from "../../lib/datetime";
import { typeByKey } from "./expenseTypes";

// STORY-ONLY — what the expense-types story files share (pages/expenses/stories/ExpenseTypes, RecordTypes,
// pages/financial-account-detail/stories/FromBiaya — live, against the real stubs). Imported by `*.stories.tsx` only.
//
// Toko Melati (12), THIS month — expenseFixtures.ts' rows, recorded BEFORE the types (they keep their group and no type:
// #501 Ads 1.500.000, #502 Payroll 4.000.000, #503 Operational 800.000 → 850.000, #505 Other 200.000 cancelled), and the
// typed rows `withTypedExpenses` adds to the expense stub, recorded by Ani Rahayu (61):
//
//   Iklan        #511 Konten · endorse 300.000 · #512 Iklan marketplace 250.000 (Melati Official)
//   Gaji         #513 Bonus 600.000 · #514 Iuran (BPJS) 400.000
//   Operasional  #515 Listrik 255.000 · #516 Internet 128.000 · #517 Dapur 213.000 · #518 Alat 1.150.000 ·
//                #519 Biaya bank 6.500 · #520 Selisih · transaksi tak tercatat 24.000
//   Lainnya      #521 Utang luar dibayar 500.000 · #522 Piutang luar diterima 350.000 (in) · #523 Prive 2.000.000 (today) ·
//                #524 Setoran modal 1.000.000 (today) — a Setor Modal made on the ACCOUNT PAGE, the same one record
//                (origin ACCOUNT_PAGE: *Dicatat di halaman akun*; withCapitalRows' by-hand row) · #525 Uang masuk lain
//                150.000 (in) · #526 Uang keluar lain 75.000
//
//   groups   Iklan 2.050.000 · Gaji 5.000.000 · Operasional 2.626.500 · Lainnya 1.075.000 (net)
//   spending 10.251.500 · money in −500.000 · capital 1.000.000 (2.000.000 − 1.000.000) → month total 10.751.500

const ANI = 61n;
const T0 = 1_781_000_000n;

/** The typed rows the stories lean on. */
export const TYPED = {
  content: 511n,
  adsMarketplace: 512n,
  bonus: 513n,
  electricity: 515n,
  discrepancy: 520n,
  outsideDebt: 521n,
  receivable: 522n,
  prive: 523n,
  deposit: 524n,
  otherIn: 525n,
} as const;

/** The figures the rows add up to — the server's totals, asserted by the stories. */
export const MONTH = {
  ads: 2_050_000,
  payroll: 5_000_000,
  operational: 2_626_500,
  other: 1_075_000,
  spending: 10_251_500,
  moneyIn: 500_000,
  capital: 1_000_000,
  total: 10_751_500,
} as const;

const day = (d: number) => `${CURRENT_MONTH}-${String(d).padStart(2, "0")}`;

function typed(
  id: bigint,
  key: string,
  amount: number,
  occurredAt: string,
  note: string,
  financeAccountId: bigint,
  extra: Partial<ExpenseFixture> = {},
): ExpenseFixture {
  const def = typeByKey(key)!;

  return {
    id,
    teamId: EXPENSE_TEAM,
    shopId: 0n,
    kind: def.group,
    type: def.id,
    amount,
    occurredAt,
    note,
    createdBy: ANI,
    createdAtUnix: T0 + id,
    adjustsExpenseId: 0n,
    financeAccountId,
    ...extra,
  };
}

/** The typed month, as expense_service stored it. */
export function typedExpenses(): ExpenseFixture[] {
  const today = todayWibDateInput();

  return [
    typed(TYPED.content, "contentEndorse", 300_000, day(6), "Endorse @rina.makeup — 2 videos", BCA_OPERASIONAL),
    typed(TYPED.adsMarketplace, "adsMarketplace", 250_000, day(7), "Shopee ads — week 2", BCA_OPERASIONAL, { shopId: 21n }),
    typed(TYPED.bonus, "bonus", 600_000, day(8), "October target reached", BCA_OPERASIONAL),
    typed(514n, "contributions", 400_000, day(10), "BPJS Ketenagakerjaan — 4 people", BCA_OPERASIONAL),
    typed(TYPED.electricity, "electricity", 255_000, day(6), "Warehouse electricity token", SHOPEEPAY_MELATI),
    typed(516n, "internet", 128_000, day(7), "IndiHome — November", SHOPEEPAY_MELATI),
    typed(517n, "kitchen", 213_000, day(9), "Lunch for the packing team", BCA_OPERASIONAL),
    typed(518n, "tools", 1_150_000, day(11), "Camera for product photos", BCA_OPERASIONAL),
    typed(519n, "bankFee", 6_500, day(12), "Monthly admin fee", BCA_OPERASIONAL),
    typed(TYPED.discrepancy, "discrepancy", 24_000, day(12), "BCA debit with no receipt", BCA_OPERASIONAL),
    typed(TYPED.outsideDebt, "outsideDebtPaid", 500_000, day(13), "Loan instalment — Pak Budi", BCA_OPERASIONAL),
    typed(TYPED.receivable, "outsideReceivableReceived", 350_000, day(14), "Toko Mawar paid back", BCA_OPERASIONAL),
    typed(TYPED.prive, "prive", 2_000_000, today, "Prive November", BCA_OPERASIONAL),
    // Made with Setor Modal on BCA Operasional's page (capital's second door) — its account row is withCapitalRows' by-hand one.
    typed(TYPED.deposit, "capitalDeposit", 1_000_000, today, "Owner's top-up for stock", BCA_OPERASIONAL, {
      origin: ExpenseOrigin.ACCOUNT_PAGE,
    }),
    typed(TYPED.otherIn, "otherIn", 150_000, day(15), "Sold used cartons", BCA_OPERASIONAL),
    typed(526n, "otherOut", 75_000, day(15), "Courier parking and tolls", SHOPEEPAY_MELATI),
  ];
}

/** A story's beforeEach: the typed month on the expense stub (preview's beforeEach resets it). */
export function withTypedExpenses() {
  addExpensesForStory(typedExpenses());
}

/**
 * THE ACCOUNT'S SIDE, on BCA Operasional (1301), as the expense listener posts it: the Prive typed on Biaya (#523) a
 * `capital` row −2.000.000 naming its expense (`expense_id` — the history's *dari Biaya #523*), the money in typed on
 * Biaya (#522) a `money_in` row +350.000, and a Setor Modal made on the account page a by-hand `capital` row
 * +1.000.000. Today. Call it from a story's beforeEach (resetFinancialAccounts in preview's beforeEach drops the rows).
 */
export function withCapitalRows() {
  const today = todayWibDateInput();
  CAPITAL_LOGS.prive = postLogForStory(
    BCA_OPERASIONAL,
    T.CAPITAL,
    -2_000_000,
    `Prive — Prive November (Expenses #${TYPED.prive})`,
    today,
    TYPED.prive,
  );
  CAPITAL_LOGS.moneyIn = postLogForStory(
    BCA_OPERASIONAL,
    T.MONEY_IN,
    350_000,
    `Outside receivable received — Toko Mawar paid back (Expenses #${TYPED.receivable})`,
    today,
    TYPED.receivable,
  );
  CAPITAL_LOGS.deposit = postLogForStory(BCA_OPERASIONAL, T.CAPITAL, 1_000_000, "Capital in — Owner's top-up for stock", today);
}

/** The account rows `withCapitalRows` posted — set before the story renders. */
export const CAPITAL_LOGS = { prive: 0n, moneyIn: 0n, deposit: 0n };

/** BCA Operasional's balance once the three rows are on it: 11.443.500 − 2.000.000 + 350.000 + 1.000.000. */
export const BCA_OPS_WITH_CAPITAL = 10_793_500;
