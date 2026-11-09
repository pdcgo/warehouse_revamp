// The expenses screen's rows — served by expenseStub.ts, imported by the stories so a story asserts on the values the
// stub served.
//
// THE MONTHS ARE RELATIVE TO TODAY. The screen opens on THIS month (thisMonth(), the same helper the page uses), so a
// fixed calendar month would leave every story looking at an empty list the month after it was written.
//
// Toko Melati (12), this month — the expense, its corrections, and what each counts for:
//
//   #502  Payroll      Rp 4.000.000   day 05   untouched · OLD: made before Paid from, so NO account — and on shop
//                                              Melati Store, from before a shop was for ads only
//   #505  Other        Rp   200.000   day 04   CANCELLED by #506 (−200.000) → counts for Rp 0 · Paid from BCA Operasional
//   #503  Operational  Rp   800.000   day 03   ADJUSTED by #504 (+50.000)  → counts for Rp 850.000 · Paid from
//                                              ShopeePay Melati
//   #501  Ads          Rp 1.500.000   day 02   on shop Melati Official · Paid from BCA Operasional
//   An adjustment carries its expense's account, copied (a-correction-follows-the-expenses-account).
//
// The accounts are financialAccountFixtures.ts' — Melati's two OPERATIONAL ones (BCA Operasional 1301, ShopeePay
// Melati 1303), the list a restock's Paid from picks from.
//   totals: Ads 1.500.000 · Payroll 4.000.000 · Operational 850.000 · Other 0 → Rp 6.350.000
//
// Toko Melati, LAST month: #481 Payroll 3.500.000 (day 05), #480 Operational 750.000 (day 10) → Rp 4.250.000 — both
// old, naming no account.
// Toko Kenanga (13) has recorded nothing — the screen as a team first opens it.

import { ExpenseKind } from "../src/gen/warehouse/expense/v1/expense_pb";
import { thisMonth } from "../src/lib/period";

export interface ExpenseFixture {
  id: bigint;
  teamId: bigint;
  shopId: bigint;
  kind: ExpenseKind;
  /** On an expense positive; on an adjustment signed, never 0. */
  amount: number;
  occurredAt: string;
  note: string;
  createdBy: bigint;
  createdAtUnix: bigint;
  /** 0 on an expense; the corrected expense on an adjustment. */
  adjustsExpenseId: bigint;
  /** The account that paid (an-expense-must-name-the-account-that-paid); 0 on an expense made before Paid from. */
  financeAccountId: bigint;
}

/** Melati's operational accounts (financialAccountFixtures.ts) — what Paid from offers. */
export const BCA_OPERASIONAL = 1301n;
export const SHOPEEPAY_MELATI = 1303n;

/** Toko Melati — the selling team with a month of expenses. */
export const EXPENSE_TEAM = 12n;
/** Toko Kenanga — a selling team that has recorded nothing. */
export const QUIET_TEAM = 13n;

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + by, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const CURRENT_MONTH = thisMonth();
export const LAST_MONTH = shiftMonth(CURRENT_MONTH, -1);
/** A month nothing was recorded in — the e2e's 2020-01. */
export const EMPTY_MONTH = "2020-01";

const day = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

// Whoever typed them — opaque user ids, never shown on the list.
const BUDI = 2n;
const SITI = 3n;
const T0 = 1_780_000_000n;

const row = (
  r: Omit<ExpenseFixture, "teamId" | "createdBy" | "createdAtUnix" | "adjustsExpenseId" | "shopId" | "financeAccountId"> &
  Partial<ExpenseFixture>): ExpenseFixture => ({
  teamId: EXPENSE_TEAM,
  shopId: 0n,
  createdBy: BUDI,
  createdAtUnix: T0 + r.id,
  adjustsExpenseId: 0n,
  financeAccountId: 0n,
  ...r,
});

export const expenseFixtures: ExpenseFixture[] = [
  // Last month.
  row({ id: 480n, kind: ExpenseKind.OPERATIONAL, amount: 750_000, occurredAt: day(LAST_MONTH, 10), note: "Internet" }),
  row({ id: 481n, kind: ExpenseKind.PAYROLL, amount: 3_500_000, occurredAt: day(LAST_MONTH, 5), note: "Packing wages" }),

  // This month.
  row({
    id: 501n,
    kind: ExpenseKind.ADS,
    amount: 1_500_000,
    occurredAt: day(CURRENT_MONTH, 2),
    note: "Shopee ads — week 1",
    shopId: 21n,
    financeAccountId: BCA_OPERASIONAL,
  }),
  // OLD: made before Paid from — no account — and naming a shop on a payroll, from before a shop was for ads only.
  row({
    id: 502n,
    kind: ExpenseKind.PAYROLL,
    amount: 4_000_000,
    occurredAt: day(CURRENT_MONTH, 5),
    note: "Packing wages",
    shopId: 22n,
  }),
  row({
    id: 503n,
    kind: ExpenseKind.OPERATIONAL,
    amount: 800_000,
    occurredAt: day(CURRENT_MONTH, 3),
    note: "Electricity",
    financeAccountId: SHOPEEPAY_MELATI,
  }),
  row({
    id: 504n,
    kind: ExpenseKind.OPERATIONAL,
    amount: 50_000,
    occurredAt: day(CURRENT_MONTH, 3),
    note: "The invoice says 850.000",
    createdBy: SITI,
    adjustsExpenseId: 503n,
    financeAccountId: SHOPEEPAY_MELATI,
  }),
  row({
    id: 505n,
    kind: ExpenseKind.OTHER,
    amount: 200_000,
    occurredAt: day(CURRENT_MONTH, 4),
    note: "Team lunch",
    financeAccountId: BCA_OPERASIONAL,
  }),
  row({
    id: 506n,
    kind: ExpenseKind.OTHER,
    amount: -200_000,
    occurredAt: day(CURRENT_MONTH, 4),
    note: "Cancelled",
    createdBy: SITI,
    adjustsExpenseId: 505n,
    financeAccountId: BCA_OPERASIONAL,
  }),
];

/** The id the next recorded expense or adjustment gets. */
export const FIRST_NEW_EXPENSE_ID = 600n;
