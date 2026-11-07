// What the account report's Export ASKED the stub (a-report-export-is-the-whole-view-as-a-file) — a story reads it to
// prove the file is asked for the view on screen with the report's own filters. Kept here, not in
// financialAccountStub.ts, so a story never imports the stub (tsconfig includes only src). Reset with the stub's ledger
// (resetFinancialAccounts).

import type { FilterItem, GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { FinancialAccountReportView } from "../src/gen/warehouse/financial_account/v1/financial_account_analytic_pb";

export interface AccountReportExportCall {
  teamId: bigint;
  view: FinancialAccountReportView;
  filters: FilterItem[];
  groupBy: GroupType;
  sortType: SortType;
  /** The rows the file holds — the periods, or every breakdown's rows together. */
  rows: number;
}

export const accountReportExportScenario = {
  calls: [] as AccountReportExportCall[],
};

export function resetAccountReportExportScenario() {
  accountReportExportScenario.calls = [];
}
