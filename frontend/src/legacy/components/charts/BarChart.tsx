import { useState } from "react";
import { Box, Portal, Text } from "@chakra-ui/react";
import { ChartFrame, ChartGrid } from "./ChartFrame";
import { buildPlot, type ChartSeries } from "./chartScale";
import { MAX_SERIES, useSeriesColors } from "./palette";

// The gap between a bar and its neighbour, in pixels of SURFACE — not a percentage.
//
// It is a fixed 2px because its job is to separate two fills so the eye reads two marks rather than
// one wide one, and that job does not scale with the bar width. A percentage gap vanishes on a
// dense chart, which is exactly where the separation is needed.
const BAR_GAP = 2;
// Data-ends are rounded 4px — at the VALUE end only. See barPath.
const BAR_RADIUS = 4;

// barPath draws a bar rounded at the value end and SQUARE at the baseline.
//
// A plain rect with `rx` rounds all four corners, which lifts the bar off the axis it is measured
// from: on a short bar the result reads as a floating pill rather than as a quantity growing out of
// the baseline. The difference is most visible exactly where accuracy matters most — the small
// values, where the rounding is a large fraction of the bar.
//
// Negative bars grow downward, so the rounding flips to the bottom corners.
function barPath(x: number, y: number, width: number, height: number, negative: boolean): string {
  if (height <= 0 || width <= 0) return "";

  const r = Math.max(0, Math.min(BAR_RADIUS, width / 2, height));
  const flat = width - 2 * r;

  if (negative) {
    // Square at the top (the baseline), rounded at the bottom (the value end).
    return [
      `M${x},${y}`,
      `h${width}`,
      `v${height - r}`,
      `a${r},${r} 0 0 1 ${-r},${r}`,
      `h${-flat}`,
      `a${r},${r} 0 0 1 ${-r},${-r}`,
      "Z",
    ].join(" ");
  }

  // Rounded at the top (the value end), square at the bottom (the baseline).
  return [
    `M${x},${y + r}`,
    `a${r},${r} 0 0 1 ${r},${-r}`,
    `h${flat}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${height - r}`,
    `h${-width}`,
    "Z",
  ].join(" ");
}

export interface BarChartProps {
  labels: string[];
  series: ChartSeries[];
  loading?: boolean;
  height?: number;
  // Stack the series instead of placing them side by side. Stacked answers "what does the TOTAL
  // consist of"; grouped answers "how do these compare at each point". They are different questions
  // and stacking one that should be grouped makes the individual series impossible to compare,
  // because only the bottom one starts from a common baseline.
  stacked?: boolean;
  formatValue?(value: number): string;
  emptyText?: string;
}

export const description =
  "A bar chart in inline SVG — no charting dependency. Zero baseline is enforced (a bar encodes magnitude by length), series colours come from the validated fixed-order palette, and every bar names itself on hover.";

export function BarChart({
  labels,
  series,
  loading,
  height = 220,
  stacked,
  formatValue = (v) => v.toLocaleString("id-ID"),
  emptyText,
}: BarChartProps) {
  const colors = useSeriesColors();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  // Past the palette there is no validated ninth hue, so the tail is dropped rather than recoloured
  // with something that has not been checked against its neighbours.
  const shown = series.slice(0, MAX_SERIES);

  const width = 560;
  const plot = buildPlot(
    // A stacked chart's axis has to reach the STACK TOTAL, not the tallest single series, or the
    // top segment is drawn off the plot.
    stacked
      ? [{ name: "total", values: labels.map((_, i) => shown.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)) }]
      : shown,
    { width, height, left: 44, bottom: 20 },
  );

  const band = plot.bandWidth(labels.length);
  const groupWidth = band * 0.7;
  const barWidth = stacked ? groupWidth : (groupWidth - BAR_GAP * (shown.length - 1)) / shown.length;

  const isEmpty = labels.length === 0 || shown.length === 0;

  return (
    <ChartFrame
      loading={loading}
      isEmpty={isEmpty}
      emptyText={emptyText}
      height={height}
      legend={shown.map((s, i) => ({ name: s.name, color: colors[i] }))}
    >
      <Box position="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Bar chart: ${shown.map((s) => s.name).join(", ")}`}
          onMouseLeave={() => setHover(null)}
        >
          <ChartGrid plot={plot} formatValue={formatValue} labels={labels} />

          {labels.map((_, index) => {
            const centre = plot.x(index, labels.length);
            let stackTop = 0;

            return (
              <g key={index}>
                {shown.map((s, si) => {
                  const value = s.values[index];
                  if (value === null || value === undefined) return null;

                  const base = stacked ? stackTop : 0;
                  const y = plot.y(base + value);
                  const y0 = plot.y(base);
                  if (stacked) stackTop += value;

                  const barHeight = Math.abs(y0 - y);
                  const x = stacked
                    ? centre - groupWidth / 2
                    : centre - groupWidth / 2 + si * (barWidth + BAR_GAP);

                  // A stacked segment is inset by the same 2px, so the surface shows between
                  // segments exactly as it does between grouped bars.
                  const inset = stacked && si > 0 ? BAR_GAP : 0;

                  return (
                    <path
                      key={si}
                      d={barPath(
                        x,
                        Math.min(y, y0) + inset,
                        Math.max(0, barWidth),
                        Math.max(0, barHeight - inset),
                        value < 0,
                      )}
                      fill={colors[si]}
                    />
                  );
                })}

                {/* One full-height hit target per CATEGORY, wider than the bars themselves. Hovering
                    a 6px bar is a precision task; hovering its column is not. */}
                <rect
                  x={centre - band / 2}
                  y={plot.top}
                  width={band}
                  height={plot.innerHeight}
                  fill="transparent"
                  onMouseEnter={(e) =>
                    setHover({ index, x: e.clientX, y: e.clientY })
                  }
                  onMouseMove={(e) => setHover({ index, x: e.clientX, y: e.clientY })}
                  data-testid={`bar-hit-${index}`}
                />
              </g>
            );
          })}
        </svg>

        {hover && (
          // Portalled and pointer-events-none: a tooltip that intercepted the pointer would
          // immediately un-hover the column it is describing and flicker.
          <Portal>
            <Box
              position="fixed"
              left={`${hover.x + 12}px`}
              top={`${hover.y + 12}px`}
              bg="bg.subtle"
              borderWidth="1px"
              borderRadius="l2"
              boxShadow="sm"
              px="2"
              py="1.5"
              pointerEvents="none"
              zIndex="tooltip"
              data-testid="chart-tooltip"
            >
              <Text fontSize="xs" fontWeight="medium">
                {labels[hover.index]}
              </Text>
              {shown.map((s, si) => (
                <Text key={si} fontSize="xs" color="fg.muted" display="flex" alignItems="center" gap="1.5">
                  <Box as="span" boxSize="2" borderRadius="sm" bg={colors[si]} aria-hidden />
                  {s.name}: {formatValue(s.values[hover.index] ?? 0)}
                </Text>
              ))}
            </Box>
          </Portal>
        )}
      </Box>
    </ChartFrame>
  );
}
