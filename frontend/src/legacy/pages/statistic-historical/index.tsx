import { useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { BarChart } from "../../components/charts/BarChart";
import { LineChart } from "../../components/charts/LineChart";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SegmentedRadio } from "../../components/inputs/SegmentedRadio";
import { PeriodGrainPicker } from "../../../components/datetime/PeriodGrainPicker";
import type { PeriodGrain } from "../../../lib/period";
import { formatRupiahCompact } from "../../../lib/money";
import { METRIC_SERIES, METRIC_SPINE } from "../../fixtures";

// The HISTORICAL screen — the one statistics view with no dimension.
//
// Its siblings all break a period down BY something (product, shop, team). This one asks the
// opposite question: how has the whole business moved over time. So it has no table of rows to act
// on, and giving it one would be inventing a breakdown the screen is not about.
//
// What it does have instead is a GRAIN control, and that is the decision worth stating: the same
// series read daily, monthly and yearly answers three different questions — daily shows the weekend
// dip, monthly shows the trend, yearly shows the business. A screen fixed to one grain silently
// picks which of the three the reader is allowed to ask.
export const description =
  "The historical view — the one statistics screen with no dimension, because it asks how the whole business moved rather than what the period breaks down into. Its grain control is the point: daily, monthly and yearly answer different questions.";

export type HistoricalShape = "line" | "bar";

export interface StatisticHistoricalPageProps {
  labels?: string[];
  series?: Array<{ name: string; values: Array<number | null> }>;
  loading?: boolean;
}

export function StatisticHistoricalPage({
  labels = METRIC_SPINE,
  series = METRIC_SERIES,
  loading,
}: StatisticHistoricalPageProps) {
  const [grain, setGrain] = useState<PeriodGrain>("month");
  const [shape, setShape] = useState<HistoricalShape>("line");

  const totalRevenue = series[0]?.values.reduce<number>((sum, v) => sum + (v ?? 0), 0) ?? 0;
  const totalCost = series[1]?.values.reduce<number>((sum, v) => sum + (v ?? 0), 0) ?? 0;

  return (
    <Stack gap="section" data-testid="statistic-historical-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Stack gap="0.5">
          <Heading size="md">Historical</Heading>
          <Text fontSize="sm" color="fg.muted">
            How the business has moved, over time.
          </Text>
        </Stack>

        <HStack gap="2">
          {/* Line for a TREND, bars for COMPARING periods against each other. Both are legitimate
              readings of the same series, which is why it is a toggle and not a fixed choice. */}
          <SegmentedRadio
            items={[
              { value: "line", label: "Trend" },
              { value: "bar", label: "Compare" },
            ]}
            value={shape}
            onChange={(v) => setShape(v as HistoricalShape)}
          />
          <Button tone="plain" variant="outline" icon={Download}>
            Export
          </Button>
        </HStack>
      </HStack>

      {/* The grain control — the same series read at three resolutions answers three questions. */}
      <PeriodGrainPicker value={grain} onChange={setGrain} />

      <Summary
        items={[
          { label: "Revenue", value: formatRupiahCompact(BigInt(totalRevenue * 1000)), tone: "success" },
          { label: "Cost", value: formatRupiahCompact(BigInt(totalCost * 1000)), tone: "warning" },
          {
            label: "Margin",
            value: formatRupiahCompact(BigInt((totalRevenue - totalCost) * 1000)),
            tone: "active",
          },
        ]}
        loading={loading}
        columns={3}
      />

      {shape === "line" ? (
        <LineChart
          labels={labels}
          series={series}
          loading={loading}
          formatValue={(v) => formatRupiahCompact(BigInt(Math.round(v * 1000)))}
        />
      ) : (
        <BarChart
          labels={labels}
          series={series}
          loading={loading}
          formatValue={(v) => formatRupiahCompact(BigInt(Math.round(v * 1000)))}
        />
      )}
    </Stack>
  );
}
