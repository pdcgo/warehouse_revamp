import { financialAccountAnalyticClient } from "../../api/clients";
import { GroupType, SortType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { FinancialAccountReportView } from "../../gen/warehouse/financial_account/v1/financial_account_analytic_pb";
import type { PeriodGrain } from "../../lib/period";
import { useFileExport } from "../../lib/useFileExport";
import { filtersOf } from "./analytics";

// THE ACCOUNT REPORT AS A FILE (a-report-export-is-the-whole-view-as-a-file) — the view on screen, whole, on the order
// list's pattern (one-export-is-the-list-as-a-file): the report's own window and account, .xlsx, streamed with progress,
// then downloaded.
//
//   Periode   every period of the window at the grain on screen, the quiet ones included, in the Periode heading's
//             order — the nine change types, Perubahan bersih, Saldo akhir
//   Rincian   one sheet per breakdown — Per Akun, Per Penyedia, Per Jenis — every row of each

const GROUP_OF_GRAIN: Record<PeriodGrain, GroupType> = {
  day: GroupType.DAILY,
  month: GroupType.MONTHLY,
  year: GroupType.YEARLY,
};

export function useAccountReportExport(teamId: bigint | undefined) {
  const exporter = useFileExport();

  const start = (args: {
    view: "period" | "breakdown";
    from: string;
    to: string;
    accountId: bigint;
    grain: PeriodGrain;
    dir: "asc" | "desc";
  }) =>
    teamId === undefined
      ? Promise.resolve()
      : exporter.start(
          financialAccountAnalyticClient.financialAccountReportExport({
            teamId,
            filters: filtersOf(args.from, args.to, args.accountId),
            ...(args.view === "period"
              ? {
                  view: FinancialAccountReportView.PERIOD,
                  groupBy: GROUP_OF_GRAIN[args.grain],
                  sortType: args.dir === "asc" ? SortType.ASC : SortType.DESC,
                }
              : { view: FinancialAccountReportView.BREAKDOWN }),
          }),
        );

  return { ...exporter, start };
}
