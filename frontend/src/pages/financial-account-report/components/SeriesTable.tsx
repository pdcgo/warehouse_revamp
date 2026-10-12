import { useTranslation } from "react-i18next";
import { Table, Text } from "@chakra-ui/react";

import type { AccountReportPoint } from "../../../features/financialAccount/analytics";
import { BalanceText } from "../../../features/financialAccount/badges";
import type { PeriodGrain } from "../../../lib/period";
import { TypeCells, TypeHeaders, signed } from "./MetricColumns";

function periodLabel(at: string, grain: PeriodGrain): string {
  if (grain === "month") return at.slice(0, 7);
  if (grain === "year") return at.slice(0, 4);

  return at;
}

// One row per period, NEWEST first — the quiet ones included, because a quiet day still carries the
// balance forward and a missing row reads as a day that did not load.
export function SeriesTable({ grain, points }: { grain: PeriodGrain; points: AccountReportPoint[] }) {
  const { t } = useTranslation();

  if (points.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="account-report-series-empty">
        {t("financialAccounts.report.empty")}
      </Text>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="account-report-series">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("financialAccounts.report.period")}</Table.ColumnHeader>
            <TypeHeaders />
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.close")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {points.map((point) => (
            <Table.Row key={point.at} data-testid={`account-report-series-row-${point.at}`}>
              <Table.Cell whiteSpace="nowrap">{periodLabel(point.at, grain)}</Table.Cell>
              <TypeCells metric={point.metric} />
              <Table.Cell textAlign="end" whiteSpace="nowrap">
                <Text fontSize="sm" fontWeight="medium">
                  {signed(point.metric.change)}
                </Text>
              </Table.Cell>
              <Table.Cell textAlign="end" whiteSpace="nowrap">
                <BalanceText balance={point.metric.closeBalance} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}
