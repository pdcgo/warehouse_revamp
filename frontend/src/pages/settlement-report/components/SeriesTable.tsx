import { useTranslation } from "react-i18next";
import { Box, Table, Text } from "@chakra-ui/react";

import type { SettlementPoint } from "../../../features/settlement/analytics";
import type { SettlementMeasure } from "../../../features/settlement/measure";
import { formatRupiah } from "../../../lib/money";
import type { PeriodGrain } from "../../../lib/period";

// The bucket's label at its grain: the day, the month, or the year its first day opens.
function periodLabel(at: string, grain: PeriodGrain): string {
  if (grain === "month") return at.slice(0, 7);
  if (grain === "year") return at.slice(0, 4);

  return at;
}

// One row per period, NEWEST first — every period in the window, the quiet ones included, because a
// quiet week still carries the shortfall forward and a missing row reads as a period that did not load.
export function SeriesTable({ grain, points }: { grain: PeriodGrain; points: SettlementPoint[] }) {
  const { t } = useTranslation();

  if (points.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="report-series-empty">
        {t("settlementReport.empty")}
      </Text>
    );
  }

  return (
    <Box overflowX="auto">
      <Table.Root size="sm" data-testid="report-series-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("settlementReport.col.period")}</Table.ColumnHeader>
            <MeasureHeaders />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {points.map((point) => (
            <Table.Row key={point.at} data-testid={`report-series-row-${point.at}`}>
              <Table.Cell>
                <Text fontSize="sm">{periodLabel(point.at, grain)}</Text>
              </Table.Cell>
              <MeasureCells measure={point.measure} />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

// The five measure columns, shared with the ranking so the two tables read identically.
export function MeasureHeaders() {
  const { t } = useTranslation();

  return (
    <>
      <Table.ColumnHeader textAlign="end">{t("settlementReport.col.sales")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("settlementReport.col.received")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("settlementReport.col.gap")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("settlementReport.col.takeRate")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("settlementReport.col.hiddenCost")}</Table.ColumnHeader>
    </>
  );
}

export function MeasureCells({ measure }: { measure: SettlementMeasure }) {
  const { t } = useTranslation();

  return (
    <>
      <Table.Cell textAlign="end">
        <Text fontSize="sm">{formatRupiah(measure.sales)}</Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text fontSize="sm">{formatRupiah(measure.received)}</Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text fontSize="sm" color={measure.gap > 0n ? "fg.error" : undefined}>
          {formatRupiah(measure.gap)}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text fontSize="sm" color="fg.muted">
          {measure.takeRate === null
            ? "—"
            : t("settlementReport.takeRateValue", { rate: measure.takeRate })}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text fontSize="sm" color="fg.muted">
          {formatRupiah(measure.hiddenCostToDate)}
        </Text>
      </Table.Cell>
    </>
  );
}
