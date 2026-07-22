import { useQuery, useQueryClient } from "@tanstack/react-query";
import { expenseClient } from "../api/clients";
import { key } from "../api/queryClient";
import type { ExpenseKind } from "../gen/warehouse/expense/v1/expense_pb";
import { monthRange } from "../lib/period";

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
        from,
        to,
        kind,
        page: { page, limit: pageSize },
      });

      return {
        expenses: res.expenses,
        totals: res.totals,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Every write on this screen invalidates the same way: the whole `expenses` domain, across every
// team and filter.
//
// Deliberately BROAD. A void changes the row, the per-kind totals, and the page counts, and an edit
// can move a row into or out of the visible month — so "invalidate exactly the affected key" is a
// calculation that would be wrong the first time a filter is added. The domain has a handful of
// cached pages, not thousands, so refetching them costs nothing worth optimising for.
export function useInvalidateExpenses() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["expenses"] });
}
