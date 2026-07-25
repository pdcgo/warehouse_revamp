import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { revenueClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import {
  type OrderRevenue,
  OrderRevenueSchema,
  RevenueListDataType,
  type RevenueListResponseItem,
  type RevenueRowItem,
} from "../../gen/warehouse/revenue/v1/revenue_pb";
import { monthRange } from "../../lib/period";

// The guideline list response carries per-id slices + a sorted `ids` list; the revenue screen wants
// OrderRevenue[], so this rebuilds them from the REVENUE (row) slice in id order at the query boundary.
function revenuesFromList(items: RevenueListResponseItem[], ids: bigint[]): OrderRevenue[] {
  let rowMap: { [key: string]: RevenueRowItem } = {};
  for (const it of items) {
    if (it.d.case === "revenue") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: OrderRevenue[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) {
      out.push(
        create(OrderRevenueSchema, {
          id: r.id,
          teamId: r.teamId,
          orderId: r.orderId,
          revenue: r.revenue,
          cogs: r.cogs,
          shippingCost: r.shippingCost,
          expectedMargin: r.expectedMargin,
          costKnown: r.costKnown,
          createdAtUnix: r.createdAtUnix,
          voided: r.voided,
        }),
      );
    }
  }

  return out;
}

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
        filter: { from, to },
        dataRequest: [RevenueListDataType.REVENUE],
        page: { page, limit: pageSize },
      });

      return {
        revenues: revenuesFromList(res.items, res.ids),
        totals: res.totals,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}
