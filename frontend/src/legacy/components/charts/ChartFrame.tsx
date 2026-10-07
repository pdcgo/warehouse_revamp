import type { ReactNode } from "react";
import { Box, HStack, Text, Wrap } from "@chakra-ui/react";
import { SpinnerOverlay } from "../feedback/SpinnerOverlay";
import type { Plot } from "./chartScale";

// Shared chart furniture: the recessive grid, the axes, and the legend. Both charts render through
// it so a bar chart and a line chart of the same data line up pixel for pixel.

export interface LegendEntry {
  name: string;
  color: string;
}

// ChartLegend is present whenever there are TWO OR MORE series, and absent for one.
//
// Both halves are rules, not preferences. With two series, colour is the only thing telling them
// apart, and colour alone is not an identification — a reader with a colour-vision deficiency, a
// greyscale print, or a forced-colours mode has nothing. With ONE series the chart's own title
// already names it, and a legend box repeating that name is furniture.
//
// The swatch is a mark; the LABEL is text in a text token. Colouring the label to match the series
// is the common mistake — it makes the text harder to read to save a swatch.
export function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length < 2) return null;

  return (
    <Wrap gap="3" pt="2" data-testid="chart-legend">
      {entries.map((entry) => (
        <HStack key={entry.name} gap="1.5">
          <Box boxSize="2.5" borderRadius="sm" bg={entry.color} flexShrink="0" aria-hidden />
          <Text fontSize="xs" color="fg.muted">
            {entry.name}
          </Text>
        </HStack>
      ))}
    </Wrap>
  );
}

// Grid lines and axis labels are RECESSIVE: they are scaffolding for reading the marks, not content.
// A grid drawn at the same weight as the data competes with it, and on a dense chart wins.
export function ChartGrid({
  plot,
  formatValue,
  labels,
}: {
  plot: Plot;
  formatValue(value: number): string;
  labels: string[];
}) {
  return (
    <g aria-hidden>
      {plot.ticks.map((tick) => {
        const y = plot.y(tick);

        return (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={plot.width}
              y1={y}
              y2={y}
              stroke="currentColor"
              // The zero line is the one grid line that carries meaning — it is what a bar's length
              // is measured from — so it is drawn stronger than its siblings.
              strokeOpacity={tick === 0 ? 0.35 : 0.12}
              strokeWidth={1}
            />
            <text
              x={plot.left - 6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.6"
            >
              {formatValue(tick)}
            </text>
          </g>
        );
      })}

      {labels.map((label, i) => (
        <text
          key={i}
          x={plot.x(i, labels.length)}
          y={plot.height - 4}
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.6"
        >
          {label}
        </text>
      ))}
    </g>
  );
}

// ChartFrame wraps a chart in its loading state, its empty state and its legend, so neither chart
// re-implements them.
export function ChartFrame({
  loading,
  isEmpty,
  emptyText = "No data for this period",
  legend,
  children,
  height,
}: {
  loading?: boolean;
  isEmpty?: boolean;
  emptyText?: string;
  legend: LegendEntry[];
  children: ReactNode;
  height: number;
}) {
  if (isEmpty) {
    return (
      <Box
        height={`${height}px`}
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="fg.muted"
        fontSize="sm"
        data-testid="chart-empty"
      >
        {emptyText}
      </Box>
    );
  }

  return (
    <SpinnerOverlay busy={loading}>
      <Box color="fg" data-testid="chart">
        {children}
        <ChartLegend entries={legend} />
      </Box>
    </SpinnerOverlay>
  );
}
