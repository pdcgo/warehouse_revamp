import { useQuery } from "@tanstack/react-query";
import { revenueClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { monthRange } from "../../lib/period";

// The revenue screen's reads (#176). Same shape as expenses — one month of a team's rows plus the
// totals the summary cards show.
export function useRevenue(args: {
  teamId: bigint | undefined;
  month: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, month, page, pageSize } = args;

  return useQuery({
    queryKey: key.revenue(teamId, { month, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const { from, to } = monthRange(month);

      const res = await revenueClient.revenueList({
        teamId: teamId!,
        from,
        to,
        page: { page, limit: pageSize },
      });

      return {
        revenues: res.revenues,
        totals: res.totals,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}
