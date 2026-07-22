import { useQuery } from "@tanstack/react-query";
import { expenseClient, revenueClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { monthRange } from "../../lib/period";

// The profit screen's read (#176).
//
// ⚠ THIS IS THE QUERY THE WHOLE EPIC WAS ABOUT.
//
// The page it replaces carried a hand-written `cancelled()` guard, threaded through the loader, the
// catch and the finally, with a long comment explaining why: switch the picker July → June and two
// reads are in flight, and a slow JULY response landing after June's paints July's figures under a
// picker that reads June — with nothing on screen to say so, because both are plausible numbers.
//
// That guard is now unnecessary. A response for a key that is no longer current is not this
// component's data, so there is nothing to discard by hand and nothing to remember to discard.
//
// ALL-OR-NOTHING is kept, deliberately. If only the expense call fails, a screen showing the margin
// it did get would report the month's whole margin as profit — wrong by exactly the costs, and
// looking entirely healthy. `Promise.all` rejects on the first failure, so the query errors and no
// half-answer reaches the screen. This is the opposite choice from WarehouseProductPage's split, and
// for the opposite reason: there, the two halves answer different questions, so one may fail alone.
// Here they are two halves of one subtraction.
export function useProfit(args: {
  teamId: bigint | undefined;
  month: string;
  totalsOnly: { page: number; limit: number };
}) {
  const { teamId, month, totalsOnly } = args;

  return useQuery({
    queryKey: key.revenue(teamId, { profit: true, month }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const { from, to } = monthRange(month);

      const [rev, cost] = await Promise.all([
        revenueClient.revenueList({ teamId: teamId!, from, to, page: totalsOnly }),
        // Every kind — UNSPECIFIED is the "any kind" filter (#170), not a kind of its own.
        expenseClient.expenseList({
          teamId: teamId!,
          from,
          to,
          kind: ExpenseKind.UNSPECIFIED,
          page: totalsOnly,
        }),
      ]);

      return { revenue: rev.totals, expenses: cost.totals };
    },
  });
}
