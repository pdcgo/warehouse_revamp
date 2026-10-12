import { useTranslation } from "react-i18next";
import { Box, Flex, Text } from "@chakra-ui/react";

import type { SettlementMeasure } from "../../../features/settlement/measure";
import { formatRupiah } from "../../../lib/money";

// The window, in the numbers that answer it — plus where the position stands at its end.
//
// ⚠ `gap` and `position to date` are DIFFERENT numbers and both are here on purpose. The gap is what
// THIS window's sales lost; the position is everything up to the window's end — the losses AND every
// withdrawal, which count in it (#withdrawal-counts-in-the-position). Withdrawn stands beside Received so
// the two can be told apart (#the-report-headline-is-position-to-date).
export function ReportSummary({ measure }: { measure: SettlementMeasure | undefined }) {
  const { t } = useTranslation();

  return (
    <Flex
      gap="card"
      wrap="wrap"
      borderWidth="1px"
      borderRadius="md"
      p="card"
      data-testid="report-summary"
    >
      <Tile
        label={t("settlementReport.sales")}
        hint={t("settlementReport.salesHint")}
        value={measure ? formatRupiah(measure.sales) : "—"}
        testId="report-sales"
      />
      <Tile
        label={t("settlementReport.received")}
        hint={t("settlementReport.receivedHint")}
        value={measure ? formatRupiah(measure.received) : "—"}
        testId="report-received"
      />
      <Tile
        label={t("settlementReport.withdrawn")}
        hint={t("settlementReport.withdrawnHint")}
        value={measure ? formatRupiah(measure.withdrawn) : "—"}
        testId="report-withdrawn"
      />
      <Tile
        label={t("settlementReport.gap")}
        hint={t("settlementReport.gapHint")}
        value={measure ? formatRupiah(measure.gap) : "—"}
        tone="fg.error"
        testId="report-gap"
      />
      <Tile
        label={t("settlementReport.takeRate")}
        value={
          measure?.takeRate !== null && measure?.takeRate !== undefined
            ? t("settlementReport.takeRateValue", { rate: measure.takeRate })
            : "—"
        }
        testId="report-take-rate"
      />
      <Tile
        label={t("settlementReport.positionToDate")}
        hint={t("settlementReport.positionToDateHint")}
        value={measure ? formatRupiah(measure.positionToDate) : "—"}
        testId="report-position"
      />
    </Flex>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  testId: string;
}) {
  return (
    <Box minW="10rem" flex="1" data-testid={testId}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="semibold" color={tone} data-testid={`${testId}-value`}>
        {value}
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
    </Box>
  );
}
