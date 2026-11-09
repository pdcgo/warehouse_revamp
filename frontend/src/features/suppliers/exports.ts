import { supplierAnalyticClient, supplierChannelClient } from "../../api/clients";
import { GroupType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { PeriodGrain } from "../../lib/period";
import { useFileExport } from "../../lib/useFileExport";
import { type SupplierRankBy, reportQuery, statisticsFilters } from "./analytics";

// EACH SUPPLIER TAB EXPORTS ITS OWN TABLE (each-supplier-tab-exports-its-own-table) — the tab's rows as a file, on the
// order list's pattern (one-export-is-the-list-as-a-file): the tab's own filter, every page, its columns, .xlsx,
// streamed with progress, then downloaded. One hook per tab; each sends what its table was asked with.

/** The Toko tab: SupplierChannelExport with the list's own filter — the settled search and the type. */
export function useStoreExport(teamId: bigint | undefined) {
  const exporter = useFileExport();

  const start = (filter: { supplierId: bigint; q: string; channelType: Marketplace }) =>
    teamId === undefined
      ? Promise.resolve()
      : exporter.start(supplierChannelClient.supplierChannelExport({ teamId, filter }));

  return { ...exporter, start };
}

const GROUP_OF_GRAIN: Record<PeriodGrain, GroupType> = {
  day: GroupType.DAILY,
  month: GroupType.MONTHLY,
  year: GroupType.YEARLY,
};

/**
 * The Statistik tab: SupplierFigureExport of the view on screen — Per Periode at its grain, or Per Produk — over the
 * tab's own filters.
 */
export function useStatisticsExport(teamId: bigint | undefined) {
  const exporter = useFileExport();

  const start = (args: {
    supplierId: bigint;
    from: string;
    to: string;
    restockTeamId: bigint;
    view: "time" | "product";
    grain: PeriodGrain;
  }) =>
    teamId === undefined
      ? Promise.resolve()
      : exporter.start(
          supplierAnalyticClient.supplierFigureExport({
            teamId,
            groupBy: args.view === "product" ? GroupType.PRODUCT : GROUP_OF_GRAIN[args.grain],
            filters: statisticsFilters(args),
          }),
        );

  return { ...exporter, start };
}

/**
 * The Supplier Report: SupplierReportExport of the whole ranking as narrowed — the report's own window, team, settled
 * search and order, every page (a-report-export-is-the-whole-view-as-a-file).
 */
export function useReportExport(teamId: bigint | undefined) {
  const exporter = useFileExport();

  const start = (args: { from: string; to: string; restockTeamId: bigint; q: string; rankBy: SupplierRankBy }) =>
    teamId === undefined
      ? Promise.resolve()
      : exporter.start(supplierAnalyticClient.supplierReportExport({ teamId, ...reportQuery(args) }));

  return { ...exporter, start };
}
