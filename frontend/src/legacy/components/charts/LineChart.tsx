import { useState } from "react";
import { Box, Portal, Text } from "@chakra-ui/react";
import { ChartFrame, ChartGrid } from "./ChartFrame";
import { buildPlot, type ChartSeries, type Plot } from "./chartScale";
import { MAX_SERIES, useSeriesColors } from "./palette";

// 2px: heavy enough to hold its colour across a gap, light enough that four series do not turn the
// plot into a solid block.
const LINE_WIDTH = 2;
// Markers are 8px across at minimum — below that they read as noise on the line rather than as
// points, and they stop being hoverable targets.
const MARKER_SIZE = 8;

// buildPath emits one path, BREAKING at nulls rather than interpolating across them.
//
// That break is the whole reason this is not a one-liner. A null is "we have no reading for this
// day" — a scanner that was offline, a period before the shop existed — and joining across it draws
// a straight line the data never claimed. On a stock or revenue chart that invented segment is
// indistinguishable from a real flat period.
function buildPath(values: Array<number | null>, plot: Plot, count: number): string {
  let path = "";
  let penDown = false;

  values.forEach((value, i) => {
    if (value === null || value === undefined) {
      penDown = false;
      return;
    }

    const x = plot.x(i, count);
    const y = plot.y(value);
    path += `${penDown ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    penDown = true;
  });

  return path.trim();
}

export interface LineChartProps {
  labels: string[];
  series: ChartSeries[];
  loading?: boolean;
  height?: number;
  // Let the axis start above zero to show detail in a narrow band.
  //
  // ⚠ Legitimate for a LINE (which encodes change by slope) and never for a bar (which encodes
  // magnitude by length). Even here it exaggerates: use it when the question is "which way is it
  // moving", not "how big is it".
  zoomAxis?: boolean;
  formatValue?(value: number): string;
  emptyText?: string;
}

export const description =
  "A line chart in inline SVG — no charting dependency. Gaps in the data BREAK the line rather than interpolating across them, and a crosshair reads every series at once.";

export function LineChart({
  labels,
  series,
  loading,
  height = 220,
  zoomAxis,
  formatValue = (v) => v.toLocaleString("id-ID"),
  emptyText,
}: LineChartProps) {
  const colors = useSeriesColors();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  const shown = series.slice(0, MAX_SERIES);

  const width = 560;
  const plot = buildPlot(shown, {
    width,
    height,
    left: 44,
    bottom: 20,
    zeroBaseline: !zoomAxis,
  });

  const band = plot.bandWidth(labels.length);
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
          aria-label={`Line chart: ${shown.map((s) => s.name).join(", ")}`}
          onMouseLeave={() => setHover(null)}
        >
          <ChartGrid plot={plot} formatValue={formatValue} labels={labels} />

          {/* The crosshair, under the marks so it never obscures a point. */}
          {hover && (
            <line
              x1={plot.x(hover.index, labels.length)}
              x2={plot.x(hover.index, labels.length)}
              y1={plot.top}
              y2={plot.top + plot.innerHeight}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="1"
              aria-hidden
            />
          )}

          {shown.map((s, si) => (
            <path
              key={si}
              d={buildPath(s.values, plot, labels.length)}
              fill="none"
              stroke={colors[si]}
              strokeWidth={LINE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Markers only on the hovered column. A dot on every point of every series is what turns
              a readable chart into a bead curtain; on hover they are the read-out. */}
          {hover &&
            shown.map((s, si) => {
              const value = s.values[hover.index];
              if (value === null || value === undefined) return null;

              return (
                <circle
                  key={si}
                  cx={plot.x(hover.index, labels.length)}
                  cy={plot.y(value)}
                  r={MARKER_SIZE / 2}
                  fill={colors[si]}
                  // A 2px surface ring, so two series crossing at the same point stay two marks.
                  stroke="var(--chakra-colors-bg)"
                  strokeWidth="2"
                />
              );
            })}

          {/* A hit column per category — the line itself is a 2px target and hovering it exactly is
              not a reasonable thing to ask. */}
          {labels.map((_, index) => (
            <rect
              key={index}
              x={plot.x(index, labels.length) - band / 2}
              y={plot.top}
              width={band}
              height={plot.innerHeight}
              fill="transparent"
              onMouseEnter={(e) => setHover({ index, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover({ index, x: e.clientX, y: e.clientY })}
              data-testid={`line-hit-${index}`}
            />
          ))}
        </svg>

        {hover && (
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
              {shown.map((s, si) => {
                const value = s.values[hover.index];

                return (
                  <Text key={si} fontSize="xs" color="fg.muted" display="flex" alignItems="center" gap="1.5">
                    <Box as="span" boxSize="2" borderRadius="sm" bg={colors[si]} aria-hidden />
                    {/* A gap is reported AS a gap. Showing 0 for "no reading" is the same lie the
                        line deliberately refuses to draw. */}
                    {s.name}: {value === null || value === undefined ? "—" : formatValue(value)}
                  </Text>
                );
              })}
            </Box>
          </Portal>
        )}
      </Box>
    </ChartFrame>
  );
}
