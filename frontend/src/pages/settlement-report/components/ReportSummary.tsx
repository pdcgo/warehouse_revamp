import { useTranslation } from "react-i18next";
import { Box, Flex, Text } from "@chakra-ui/react";

import type { SettlementMeasure } from "../../../features/settlement/measure";
import { formatRupiah } from "../../../lib/money";

// The window, in the four numbers that answer it — plus where the shortfall stands at its end.
//
// ⚠ `gap` and `hidden cost to date` are DIFFERENT numbers and both are here on purpose. The gap is what
// THIS window's sales lost; the hidden cost is everything lost up to the window's end. A shop with a bad
// month and a good one reads the same gap twice and a growing hidden cost.
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
        label={t("settlementReport.hiddenCost")}
        hint={t("settlementReport.hiddenCostHint")}
        value={measure ? formatRupiah(measure.hiddenCostToDate) : "—"}
        testId="report-hidden-cost"
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
