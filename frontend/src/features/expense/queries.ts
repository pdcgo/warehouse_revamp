import { useQuery } from "@tanstack/react-query";
import { expenseAnalyticClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";
import { peopleFor, WHO_FILTER_SIZE } from "../users/queries";

// The expense domain's reads shared beyond the Expenses page (pages/expenses/queries.ts keeps that page's own).

// WHO A USER FILTER OVER AN EXPENSE METRIC OFFERS (a-who-filter-lists-the-people-on-its-rows): everyone an expense report
// row of the reader's scope counts for — ExpensePersonList, read off the rows the metric's USER group reads: whoever typed
// an expense and whoever corrected one (an-expense-correction-counts-for-who-made-it) — the latest first, named with one
// UserByIDs. A team reads its own people, the root team every team's. Never the team's member list or the system-wide
// user search.
//
// `metricIds` are the expense metrics on the table: with Ads expense alone the service offers only the people on its ADS
// rows. `key.expenses`: an expense typed or corrected on the Expenses page refreshes it. `referenceQuery`: it LABELS a
// picker, and is re-read whenever one mounts.
export function useExpensePeople(args: { teamId: bigint | undefined; metricIds: string[]; enabled?: boolean }) {
  const { teamId, metricIds, enabled = true } = args;
  const asked = [...metricIds].sort();

  return useQuery({
    queryKey: key.expenses(teamId, { people: asked.join(",") }),
    ...referenceQuery,
    enabled: enabled && teamId !== undefined,
    queryFn: async () => {
      const res = await expenseAnalyticClient.expensePersonList({
        teamId: teamId!,
        filter: { metricIds: asked },
        page: { page: 1, limit: WHO_FILTER_SIZE },
      });

      return peopleFor(res.ids);
    },
  });
}
