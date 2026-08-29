import { useQuery } from "@tanstack/react-query";

import { expenseClient, liabilityClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import type { ExpenseDayItem, ExpenseTotals } from "../../gen/warehouse/expense/v1/expense_pb";
import { LiabilitySourceType } from "../../gen/warehouse/liability/v1/liability_pb";
import type {
  LiabilityDailyTotals,
  LiabilityDayItem,
} from "../../gen/warehouse/liability/v1/liability_pb";
import { bucketOf, bucketSpine } from "../../lib/period";
import type { PeriodGrain } from "../../lib/period";

// WHOSE statement this is — and today there is only one answer.
//
//   warehouse  income = the HANDLING FEES it charged the teams it serves   (liability_service)
//
// ⚠ A `selling` mode existed and read the EXPECTED MARGIN on its orders from `revenue_service`. That
// service was removed and its statistics deferred, so the mode went with it. The union is kept at one
// member rather than deleted because the SEAM is the thing worth keeping: the spine, the subtraction
// and the running total below are mode-independent, and a second income column drops back in here.
export type StatementMode = "warehouse";

// ONE ROW OF THE STATEMENT — every service's answer for that bucket, already subtracted.
//
// A row is a DAY, a MONTH or a YEAR depending on the grain, and nothing in this shape changes with it:
// a month's row is the same nine numbers as a day's, summed over more of them. That is the whole reason
// the grain is a rollup rather than a second data path — one subtraction, one running total, one table.
//
// One flat shape for both modes rather than a discriminated union: the fields the other mode does not
// use are simply 0, and the table picks its columns from the mode. A union would double the table
// component to express a difference that is four columns wide.
export interface StatementRow {
  /** The bucket this row sums: `2026-08-18`, `2026-08` or `2026` (see {@link PeriodGrain}). */
  bucket: string;

  /** What the bucket EARNED, in this mode's terms. The top of the subtraction. */
  income: bigint;

  // ── selling only ────────────────────────────────────────────────────────────────────────────────
  orders: number;
  revenue: bigint;
  cogs: bigint;
  shippingCost: bigint;
  /** Orders whose cost was unknown (#74) — their margin reads as pure profit. */
  unknownCostOrders: number;

  // ── warehouse only ──────────────────────────────────────────────────────────────────────────────
  /** Ledger legs the bucket holds. */
  feeEntries: number;
  /** ⚠ COD is a REIMBURSEMENT of cash already paid to a courier, so it is shown but NOT in `income`. */
  codFees: bigint;

  // ── both ────────────────────────────────────────────────────────────────────────────────────────
  /** Everything in `expense_records` for the bucket, stock loss included. */
  expenses: bigint;
  /** The stock written off in it (#211) — a warehouse's biggest controllable cost. */
  stockLoss: bigint;
  /** `expenses − stockLoss` — the money somebody DECIDED to spend, as opposed to what went wrong. */
  otherExpenses: bigint;
  expenseEntries: number;

  /** income − expenses. */
  profit: bigint;
  /** Profit accumulated from the first bucket of the period THROUGH this one. */
  running: bigint;
  /** Whether anything happened at all on either side. */
  active: boolean;
}

export interface Statement {
  rows: StatementRow[];
  /** The period's income total, from the SERVER — the handling fees it charged. */
  income: bigint;
  liability: LiabilityDailyTotals | undefined;
  expenses: ExpenseTotals | undefined;
}

const HANDLING_FEE = LiabilitySourceType.HANDLING_FEE;
const COD_FEE = LiabilitySourceType.COD_FEE;

// The daily statement's read.
//
// ⚠ THE SUBTRACTION HAPPENS HERE, ON THE CLIENT, and that is not laziness — it is the same call the
// profit screen already made, for the same reason. revenue_service, expense_service and
// liability_service are independent (HARD RULE 3): none imports another, none has a table another can
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
// ⚠ THE GRAIN IS NOT PART OF THE REQUEST — it regroups an answer already in hand. The three RPCs
// return one row per DAY and take no grain of their own, so switching Daily → Monthly is a rollup of
// the same fetch rather than a different question. It is still in the query key, because the rows are
// the query's product and a cached statement at one grain is not the answer at another.
//
// That also means the 366-day cap governs every grain, which is why a yearly view can currently only
// reach one year at a time. Lifting it means the three RPCs taking a grain of their own and bounding
// the response in BUCKETS rather than days — a contract change, and not this screen's to make.
export function useDailyStatement(args: {
  teamId: bigint | undefined;
  mode: StatementMode;
  grain: PeriodGrain;
  from: string;
  to: string;
  kind: ExpenseKind;
  /** False when the range is unbounded or longer than the cap — the screen explains, nothing is sent. */
  valid: boolean;
}) {
  const { teamId, mode, grain, from, to, kind, valid } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.revenue(teamId, { statement: true, mode, grain, from, to, kind }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<Statement> => {
      // UNSPECIFIED is the "any kind" filter (#170), not a kind of its own.
      const expensesPromise = expenseClient.expenseDaily({
        teamId: teamId!,
        filter: { from, to, kind, shopId: 0n },
      });

      const [fees, exp] = await Promise.all([
        liabilityClient.liabilityDaily({ teamId: teamId!, filter: { from, to, counterpartyId: 0n } }),
        expensesPromise,
      ]);

      return {
        rows: mergeBuckets(from, to, grain, fees.days, exp.days),
        // HANDLING FEES ALONE, and this is the screen's judgement rather than the ledger's — see the
        // note on LiabilityDailyFilter. A COD fee reimburses cash the warehouse already handed a
        // courier, and a PAYMENT settles a balance that was earned when the fee was charged. Summing
        // every source and calling it income would count the same money twice.
        income: fees.totals?.bySource[HANDLING_FEE] ?? 0n,
        liability: fees.totals,
        expenses: exp.totals,
      };
    },
  });
}

// Every sparse series, gathered into the buckets of one grain — `Map<bucket, the rows that fell in it>`.
//
// A DAY LANDS IN EXACTLY ONE BUCKET AT EVERY GRAIN, which is what makes the rollup safe: the three
// services already agree on the `yyyy-mm-dd` label, so prefixing it cannot make two services disagree
// about which month a day belongs to. At `day` this map is one row per key and the rollup below is the
// identity — deliberately, so there is no separate daily path to drift.
function bucketise<T extends { date: string }>(rows: T[], grain: PeriodGrain): Map<string, T[]> {
  const out = new Map<string, T[]>();

  for (const row of rows) {
    const at = bucketOf(row.date, grain);
    const held = out.get(at);

    if (held) held.push(row);
    else out.set(at, [row]);
  }

  return out;
}

const sum = <T>(rows: T[], of: (row: T) => bigint | undefined) =>
  rows.reduce((total, row) => total + (of(row) ?? 0n), 0n);

// mergeBuckets lines every sparse series up on the client's spine and runs the subtraction.
//
// EVERY bucket in the range gets a row, including the quiet ones. That is what makes this a statement
// rather than a list of things that happened: a gap where the 14th should be leaves the reader unable to
// tell "nothing was sold" from "the 14th did not load". A quiet bucket is marked `active: false` so the
// screen can render it faintly, or hide it on request — but it is never silently missing.
//
// ⚠ THE GRAIN CHANGES THE SPINE AND NOTHING ELSE. Summing a month is summing its days, the subtraction
// is the same subtraction, and the running total still accumulates across the period — so Monthly is not
// a second implementation of this function with a different date walk, which is exactly how the two
// resolutions would start disagreeing about a period they both claim to describe.
//
// ⚠ It took TWO income series until `revenue_service` was removed — one per mode, one of them always
// empty. The spine, the subtraction and the running total never varied by mode, which is why a second
// series drops back in here as one more `bucketise` and one more term in `income`.
function mergeBuckets(
  from: string,
  to: string,
  grain: PeriodGrain,
  feeDays: LiabilityDayItem[],
  expenseDays: ExpenseDayItem[],
): StatementRow[] {
  const feesAt = bucketise(feeDays, grain);
  const expensesAt = bucketise(expenseDays, grain);

  let running = 0n;

  return bucketSpine(from, to, grain).map((bucket) => {
    const f = feesAt.get(bucket) ?? [];
    const e = expensesAt.get(bucket) ?? [];

    const income = sum(f, (d) => d.bySource[HANDLING_FEE]);

    const expenses = sum(e, (d) => d.total);
    const stockLoss = sum(e, (d) => d.byKind[ExpenseKind.STOCK_LOSS]);

    const profit = income - expenses;

    running += profit;

    return {
      bucket,
      income,

      // ⚠ RESERVED, and always zero today. These five are the selling half, kept in the row shape so
      // the table's column sets and every consumer stay as they were when statistics return.
      orders: 0,
      revenue: 0n,
      cogs: 0n,
      shippingCost: 0n,
      unknownCostOrders: 0,

      feeEntries: Number(sum(f, (d) => d.entries)),
      codFees: sum(f, (d) => d.bySource[COD_FEE]),

      expenses,
      stockLoss,
      // What somebody DECIDED to spend, as against what went wrong. Splitting them is the whole reason
      // stock loss got its own kind: rent is a choice, a dropped pallet is not, and a single
      // "Operational" column that held both could not tell a manager which one moved.
      otherExpenses: expenses - stockLoss,
      expenseEntries: Number(sum(e, (d) => d.entries)),

      profit,
      running,
      // Absent on EVERY side, not "zero money". A bucket can hold an order worth nothing and still be a
      // period somebody worked, so this asks whether any service returned a row — which is exactly what
      // the sparse series encode.
      active: f.length > 0 || e.length > 0,
    };
  });
}
