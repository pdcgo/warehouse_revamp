import { Heading, Stack } from "@chakra-ui/react";
import { Chart, useChart } from "@chakra-ui/charts";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

export const description =
  "A line graph on Chakra's charts (`a-chart-is-chakras-chart`): the points along the bottom in the order given, the value up the side, one line per series, named in the legend under it. Every value is formatted by the caller, in full in the tooltip and short on the side axis (`formatTick`, so the magnitude reads first), so the graph reads like the table beside it. Line colours are categorical hues taken in order, because a colour here tells two lines apart and never says good or bad. Up to 31 points carry a dot on each value. Past that the line alone is easier to read.";

/** The colours lines take, in order. CATEGORICAL hues: a line is told apart by its colour, never judged by it. */
export const LINE_COLORS = ["teal.solid", "purple.solid", "orange.solid", "blue.solid", "pink.solid", "cyan.solid"] as const;

/** Above this many points the dots crowd the line, so they go. A month of days still has them. */
const DOTS_UP_TO = 31;

export interface LineGraphLine {
  /** What the legend and the tooltip call it. */
  label: string;
  /** One value per point, in the points' order. A missing one draws as 0. */
  values: number[];
}

export interface LineGraphProps {
  title: string;
  /** What the bottom axis prints, one per point, in the order they are drawn. */
  labels: string[];
  lines: LineGraphLine[];
  /** A value in full, as the tooltip shows it. */
  formatValue: (value: number) => string;
  /** A value on the side axis. Defaults to `formatValue`. */
  formatTick?: (value: number) => string;
  /** The values are counted things, so the side axis never steps by a fraction (no "1,5 units"). */
  wholeNumbers?: boolean;
  testId?: string;
}

/** One point: its label along the bottom, and each line's value at it, keyed `l0`, `l1`, … */
type Point = { x: string } & Record<string, string | number>;

export function LineGraph({ title, labels, lines, formatValue, formatTick, wholeNumbers = false, testId }: LineGraphProps) {
  // Recharts reads a value by its data key, and a key with a "." is read as a path. The lines are keyed by
  // position instead of by their labels, so no label can break the drawing.
  const chart = useChart<Point>({
    data: labels.map((label, i) => ({ x: label, ...Object.fromEntries(lines.map((line, j) => [`l${j}`, line.values[i] ?? 0])) })),
    series: lines.map((line, j) => ({ name: `l${j}`, label: line.label, color: LINE_COLORS[j % LINE_COLORS.length] })),
  });
  const dots = labels.length <= DOTS_UP_TO;

  return (
    <Stack gap="2" data-testid={testId}>
      <Heading size="sm">{title}</Heading>
      <Chart.Root chart={chart} aspectRatio="auto" h={{ base: "56", md: "64" }} aria-label={title}>
        <LineChart data={chart.data} responsive margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chart.color("border")} vertical={false} />
          {/* When the labels crowd, the ones between give way and both ends stay, so the graph always says where it starts. */}
          <XAxis
            dataKey={chart.key("x")}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            stroke={chart.color("border")}
          />
          <YAxis
            width="auto"
            allowDecimals={!wholeNumbers}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tickFormatter={formatTick ?? formatValue}
            stroke={chart.color("border")}
          />
          <Tooltip
            animationDuration={100}
            cursor={{ stroke: chart.color("border") }}
            content={<Chart.Tooltip formatter={(value) => formatValue(Number(value))} />}
          />
          <Legend content={<Chart.Legend />} />
          {chart.series.map((series) => (
            <Line
              key={series.name}
              dataKey={chart.key(series.name)}
              name={series.name}
              stroke={chart.color(series.color)}
              // Hovering a legend entry fades the other lines, so one line can be followed through a crowded graph.
              strokeOpacity={chart.getSeriesOpacity(series.name)}
              strokeWidth={2}
              dot={dots ? { r: 3, strokeWidth: 0, fill: chart.color(series.color) } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Chart.Root>
    </Stack>
  );
}
