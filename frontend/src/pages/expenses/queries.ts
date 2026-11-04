import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expenseClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import {
  ExpenseListDataType,
  type ExpenseListResponseItem,
  type ExpenseKind,
  type ExpenseRecord,
  ExpenseRecordSchema,
  type ExpenseRowItem,
} from "../../gen/warehouse/expense/v1/expense_pb";
import { monthRange } from "../../lib/period";

// The guideline list response carries per-id slices + a sorted `ids` list; the expenses screen wants
// ExpenseRecord[], so this rebuilds them from the EXPENSE (row) slice in id order, at the query
// boundary, leaving the screen unchanged.
function expensesFromList(items: ExpenseListResponseItem[], ids: bigint[]): ExpenseRecord[] {
  let rowMap: { [key: string]: ExpenseRowItem } = {};
  for (const it of items) {
    if (it.d.case === "expense") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: ExpenseRecord[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) {
      out.push(
        create(ExpenseRecordSchema, {
          id: r.id,
          teamId: r.teamId,
          shopId: r.shopId,
          kind: r.kind,
          amount: r.amount,
          occurredAt: r.occurredAt,
          note: r.note,
          createdBy: r.createdBy,
          createdAtUnix: r.createdAtUnix,
          adjustsExpenseId: r.adjustsExpenseId,
          netAmount: r.netAmount,
          financeAccountId: r.financeAccountId,
        }),
      );
    }
  }

  return out;
}

// The expense screen's reads (#175). Query hooks live beside the screen that uses them, per the
// convention in api/queryClient.ts.

interface ExpenseListArgs {
  teamId: bigint | undefined;
  month: string;
  kind: ExpenseKind;
  page: number;
  pageSize: number;
}

// One month of a team's expenses, with the per-kind totals the summary cards read.
//
// `enabled` replaces the old `if (teamId === undefined) return` guard at the top of the loader: the
// team is not known on first paint (TeamProvider is still resolving memberships), and firing an
// unscoped request in that window would be rejected by the interceptor anyway.
export function useExpenses({ teamId, month, kind, page, pageSize }: ExpenseListArgs) {
  return useQuery({
    // The team is IN the key, and it is not optional — see api/queryClient.ts. Same filters, two
    // teams, two different answers.
    queryKey: key.expenses(teamId, { month, kind, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const { from, to } = monthRange(month);

      const res = await expenseClient.expenseList({
        teamId: teamId!,
        filter: { from, to, kind },
        dataRequest: [ExpenseListDataType.EXPENSE],
        page: { page, limit: pageSize },
      });

      return {
        expenses: expensesFromList(res.items, res.ids),
        totals: res.totals,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Every write on this screen invalidates the same way: the whole `expenses` domain, across every
// team and filter.
//
// Deliberately BROAD. An adjustment adds a row, changes its expense's net, the per-kind totals and the page counts —
// so "invalidate exactly the affected key" is a calculation that would be wrong the first time a filter is added. The
// domain has a handful of cached pages, not thousands, so refetching them costs nothing worth optimising for.
export function useInvalidateExpenses() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["expenses"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale.
//
// That is the point of the conversion, not the `useMutation` call itself. Before it, a dialog took an
// `onDone` callback and the PAGE remembered to refetch — so "does the screen update after a write?"
// was answered by whoever wired the props, differently each time, and the same dialog opened from a
// second place quietly refreshed nothing. A write cannot forget to invalidate if invalidating is part
// of what the write IS.
//
// The split is deliberate: the hook owns the CACHE (what a write makes stale), the component owns the
// UX (the toast, closing the dialog, showing the error). Neither has to know the other's job, which
// is why the dialog no longer needs a handle on its parent's fetching.
//
// `onSuccess` RETURNS the invalidation promise on purpose — TanStack then awaits it, so the mutation
// is not "settled" until the list behind the dialog has actually refetched. Dropping the `return`
// makes the dialog close a beat before the row appears, which reads as a write that did not land.

interface SaveExpenseVars {
  teamId: bigint;
  kind: ExpenseKind;
  amount: bigint;
  occurredAt: string;
  shopId: bigint;
  note: string;
  /** The account that paid — required (an-expense-must-name-the-account-that-paid). */
  financeAccountId: bigint;
}

// Record a cost. Recording is the only write that makes an expense — it is never edited afterwards
// (an-expense-is-never-edited).
export function useSaveExpense() {
  const invalidate = useInvalidateExpenses();

  return useMutation({
    mutationFn: (vars: SaveExpenseVars) => expenseClient.expenseCreate(vars),
    onSuccess: () => invalidate(),
  });
}

interface AdjustExpenseVars {
  teamId: bigint;
  expenseId: bigint;
  /** The correction, SIGNED — not the new total. Never 0. */
  amount: bigint;
  note: string;
}

// A refusal that means THE SCREEN'S FIGURE IS STALE: the expense is gone (NotFound), or somebody corrected it first and
// this correction would now take it below 0 (FailedPrecondition). Either way the list behind the dialog read something
// the server no longer holds — and kept on screen, that stale net is the very figure that caused the refusal.
function staleRefusal(err: unknown): boolean {
  const code = ConnectError.from(err).code;

  return code === Code.FailedPrecondition || code === Code.NotFound;
}

// Correct a cost with a new row (every-correction-is-a-signed-adjustment) — Adjust, and Batalkan, which is an
// adjustment of minus what the expense still counts for.
//
// ⚠ SETTLED, NOT ONLY SUCCEEDED: a stale-figure refusal refetches too, so the person reads what the expense counts for
// NOW beside the refusal instead of retrying against the number that was refused. Any other failure (a validation, a
// role, the network) leaves the cache alone — nothing about the list changed.
export function useAdjustExpense() {
  const invalidate = useInvalidateExpenses();

  return useMutation({
    mutationFn: (vars: AdjustExpenseVars) => expenseClient.expenseAdjust(vars),
    onSettled: (_data, err) => (err === null || staleRefusal(err) ? invalidate() : undefined),
  });
}
