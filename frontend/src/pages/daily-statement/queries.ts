import { useQuery } from "@tanstack/react-query";

import { expenseClient, revenueClient, settlementClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import type { ExpenseDayItem, ExpenseTotals } from "../../gen/warehouse/expense/v1/expense_pb";
import type { RevenueDayItem, RevenueTotals } from "../../gen/warehouse/revenue/v1/revenue_pb";
import { SettlementSourceType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import type {
  SettlementDailyTotals,
  SettlementDayItem,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import { daySpine } from "../../lib/period";

// WHOSE statement this is. The two teams earn money in completely different ways, so they read a
// different income column — but the same expenses, the same subtraction and the same running total.
//
//   selling    income = the EXPECTED MARGIN on the orders it placed        (revenue_service)
//   warehouse  income = the HANDLING FEES it charged the teams it serves   (settlement_service)
//
// A warehouse has no orders at all, so pointing it at revenue_service would give it margin 0 against
// real expenses and report every single day as a pure loss (owner, 2026-08-14).
export type StatementMode = "selling" | "warehouse";

// ONE DAY OF THE STATEMENT — every service's answer for that date, already subtracted.
//
// One flat shape for both modes rather than a discriminated union: the fields the other mode does not
// use are simply 0, and the table picks its columns from the mode. A union would double the table
// component to express a difference that is four columns wide.
export interface StatementDay {
  /** `yyyy-mm-dd`. */
  date: string;

  /** What the day EARNED, in this mode's terms. The top of the subtraction. */
  income: bigint;

  // ── selling only ────────────────────────────────────────────────────────────────────────────────
  orders: number;
  revenue: bigint;
  cogs: bigint;
  shippingCost: bigint;
  /** Orders whose cost was unknown (#74) — their margin reads as pure profit. */
  unknownCostOrders: number;

  // ── warehouse only ──────────────────────────────────────────────────────────────────────────────
  /** Ledger legs the day holds. */
  feeEntries: number;
  /** ⚠ COD is a REIMBURSEMENT of cash already paid to a courier, so it is shown but NOT in `income`. */
  codFees: bigint;

  // ── both ────────────────────────────────────────────────────────────────────────────────────────
  /** Everything in `expense_records` for the day, stock loss included. */
  expenses: bigint;
  /** The stock written off that day (#211) — a warehouse's biggest controllable cost. */
  stockLoss: bigint;
  /** `expenses − stockLoss` — the money somebody DECIDED to spend, as opposed to what went wrong. */
  otherExpenses: bigint;
  expenseEntries: number;

  /** income − expenses. */
  profit: bigint;
  /** Profit accumulated from the first day of the period THROUGH this one. */
  running: bigint;
  /** Whether anything happened at all on either side. */
  active: boolean;
}

export interface Statement {
  days: StatementDay[];
  /** The period's income total, from the SERVER. `expectedMargin` in selling mode, handling fees in warehouse mode. */
  income: bigint;
  /** Selling mode only — the revenue detail behind the margin. */
  revenue: RevenueTotals | undefined;
  /** Warehouse mode only. */
  settlement: SettlementDailyTotals | undefined;
  expenses: ExpenseTotals | undefined;
}

const HANDLING_FEE = SettlementSourceType.HANDLING_FEE;
const COD_FEE = SettlementSourceType.COD_FEE;

// The daily statement's read.
//
// ⚠ THE SUBTRACTION HAPPENS HERE, ON THE CLIENT, and that is not laziness — it is the same call the
// profit screen already made, for the same reason. revenue_service, expense_service and
// settlement_service are independent (HARD RULE 3): none imports another, none has a table another can
// read. A backend "statement" RPC would have to live in one of them and would make that one service own
// a number derived from data it does not hold. So the screen asks two of them for the same period and
// lines them up.
//
// ⚠ IT SUBTRACTS TWO DIFFERENT KINDS OF CERTAINTY in SELLING mode. The expenses are money that genuinely
// left the business — a person typed each one, or a warehouse wrote stock off. The margin is only
// EXPECTED: nothing has been reconciled against what a marketplace actually paid out. The screen says so
// rather than letting a reader take the bottom line for cash. In WAREHOUSE mode both sides are real
// ledger movements, which is why the notice is shown only in selling mode.
//
// ALL-OR-NOTHING, deliberately. If only the expense call fails, a statement showing the income it did
// get would report every day's whole income as profit — wrong by exactly the costs, and looking
// perfectly healthy. `Promise.all` rejects on the first failure so no half-answer reaches the screen.
//
// `listQuery` because a range change REFINES the same question: the same team's money over a different
// window, so the previous rows should stay on screen while the next answer loads. Pair it with
// RefreshOverlay at the call site.
export function useDailyStatement(args: {
  teamId: bigint | undefined;
  mode: StatementMode;
  from: string;
  to: string;
  kind: ExpenseKind;
  /** False when the range is unbounded or longer than the cap — the screen explains, nothing is sent. */
  valid: boolean;
}) {
  const { teamId, mode, from, to, kind, valid } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.revenue(teamId, { statement: true, mode, from, to, kind }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<Statement> => {
      // UNSPECIFIED is the "any kind" filter (#170), not a kind of its own.
      const expensesPromise = expenseClient.expenseDaily({
        teamId: teamId!,
        filter: { from, to, kind, shopId: 0n },
      });

      if (mode === "warehouse") {
        const [fees, exp] = await Promise.all([
          settlementClient.settlementDaily({ teamId: teamId!, filter: { from, to, counterpartyId: 0n } }),
          expensesPromise,
        ]);

        return {
          days: mergeDays(from, to, [], fees.days, exp.days),
          // HANDLING FEES ALONE, and this is the screen's judgement rather than the ledger's — see the
          // note on SettlementDailyFilter. A COD fee reimburses cash the warehouse already handed a
          // courier, and a PAYMENT settles a balance that was earned when the fee was charged. Summing
          // every source and calling it income would count the same money twice.
          income: fees.totals?.bySource[HANDLING_FEE] ?? 0n,
          revenue: undefined,
          settlement: fees.totals,
          expenses: exp.totals,
        };
      }

      const [rev, exp] = await Promise.all([
        revenueClient.revenueDaily({ teamId: teamId!, filter: { from, to } }),
        expensesPromise,
      ]);

      return {
        days: mergeDays(from, to, rev.days, [], exp.days),
        income: rev.totals?.expectedMargin ?? 0n,
        revenue: rev.totals,
        settlement: undefined,
        expenses: exp.totals,
      };
    },
  });
}

// mergeDays lines every sparse series up on the client's date spine and runs the subtraction.
//
// EVERY day in the range gets a row, including the quiet ones. That is what makes this a statement
// rather than a list of things that happened: a gap where the 14th should be leaves the reader unable to
// tell "nothing was sold" from "the 14th did not load". A quiet day is marked `active: false` so the
// screen can render it faintly, or hide it on request — but it is never silently missing.
//
// It takes BOTH income series and one of them is always empty, rather than being written twice per mode.
// The date spine, the subtraction and the running total are identical in both modes, and those are the
// parts worth having exactly one copy of.
function mergeDays(
  from: string,
  to: string,
  revenueDays: RevenueDayItem[],
  feeDays: SettlementDayItem[],
  expenseDays: ExpenseDayItem[],
): StatementDay[] {
  const byDateRevenue = new Map(revenueDays.map((d) => [d.date, d]));
  const byDateFee = new Map(feeDays.map((d) => [d.date, d]));
  const byDateExpense = new Map(expenseDays.map((d) => [d.date, d]));

  let running = 0n;

  return daySpine(from, to).map((date) => {
    const r = byDateRevenue.get(date);
    const f = byDateFee.get(date);
    const e = byDateExpense.get(date);

    // Whichever series this mode was given. The other map is empty, so exactly one of these is non-zero.
    const income = (r?.expectedMargin ?? 0n) + (f?.bySource[HANDLING_FEE] ?? 0n);

    const expenses = e?.total ?? 0n;
    const stockLoss = e?.byKind[ExpenseKind.STOCK_LOSS] ?? 0n;

    const profit = income - expenses;

    running += profit;

    return {
      date,
      income,

      orders: Number(r?.orders ?? 0n),
      revenue: r?.revenue ?? 0n,
      cogs: r?.cogs ?? 0n,
      shippingCost: r?.shippingCost ?? 0n,
      unknownCostOrders: Number(r?.unknownCostOrders ?? 0n),

      feeEntries: Number(f?.entries ?? 0n),
      codFees: f?.bySource[COD_FEE] ?? 0n,

      expenses,
      stockLoss,
      // What somebody DECIDED to spend, as against what went wrong. Splitting them is the whole reason
      // stock loss got its own kind: rent is a choice, a dropped pallet is not, and a single
      // "Operational" column that held both could not tell a manager which one moved.
      otherExpenses: expenses - stockLoss,
      expenseEntries: Number(e?.entries ?? 0n),

      profit,
      running,
      // Absent on EVERY side, not "zero money". A day can hold an order worth nothing and still be a day
      // somebody worked, so this asks whether any service returned a row — which is exactly what the
      // sparse series encode.
      active: r !== undefined || f !== undefined || e !== undefined,
    };
  });
}
