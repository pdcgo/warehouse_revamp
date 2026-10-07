// Shared geometry for the SVG charts. Kept out of the components so BarChart and LineChart cannot
// drift into two different ideas of where the baseline is or how a tick is chosen.

export interface ChartSeries {
  name: string;
  values: Array<number | null>;
}

export interface Plot {
  width: number;
  height: number;
  // The plotting rectangle, inside the axis gutters.
  left: number;
  top: number;
  innerWidth: number;
  innerHeight: number;
  min: number;
  max: number;
  ticks: number[];
  // Value → y pixel.
  y(value: number): number;
  // Category index → the CENTRE of its slot on x.
  x(index: number, count: number): number;
  bandWidth(count: number): number;
}

// niceStep rounds a raw step up to the nearest 1/2/5 × 10^n.
//
// Axis labels are read, not measured — "0 / 250 / 500 / 750 / 1,000" is legible at a glance where
// "0 / 233 / 466 / 699 / 932" makes the reader do arithmetic to place a bar. Any step chosen by
// dividing the range by the tick count produces the second kind.
function niceStep(raw: number): number {
  if (raw <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;

  if (normalised <= 1) return magnitude;
  if (normalised <= 2) return 2 * magnitude;
  if (normalised <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export interface PlotOptions {
  width: number;
  height: number;
  left: number;
  bottom: number;
  tickCount?: number;
  // Force the baseline to zero. Default TRUE for bars — see below.
  zeroBaseline?: boolean;
}

// buildPlot turns the data range into pixels and picks the axis ticks.
//
// ⚠ `zeroBaseline` DEFAULTS TO TRUE, and bar charts must never turn it off. A bar encodes magnitude
// by its LENGTH, so a truncated axis multiplies apparent differences — the classic way to make a 3%
// change look like a doubling. A line chart encodes change by its SLOPE and may legitimately zoom,
// which is the only reason the flag exists at all.
export function buildPlot(series: ChartSeries[], options: PlotOptions): Plot {
  const { width, height, left, bottom, tickCount = 4, zeroBaseline = true } = options;

  const flat = series.flatMap((s) => s.values).filter((v): v is number => v !== null);

  const rawMax = flat.length ? Math.max(...flat) : 0;
  const rawMin = flat.length ? Math.min(...flat) : 0;

  // A negative value forces the zero line into view whatever the caller asked for: otherwise the
  // bars below it would be drawn off the bottom of the plot.
  const includeZero = zeroBaseline || rawMin < 0;

  const step = niceStep(Math.max(Math.abs(rawMax), Math.abs(rawMin), 1) / tickCount);
  const max = Math.ceil((includeZero ? Math.max(rawMax, 0) : rawMax) / step) * step;
  const min = includeZero ? Math.min(Math.floor(rawMin / step) * step, 0) : Math.floor(rawMin / step) * step;

  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)));

  // Head-room for the TOPMOST tick label, which is centred on its grid line. With too little the
  // highest number is sliced in half by the top of the viewBox — a defect no unit test sees, because
  // the text is present and correct, just clipped.
  const top = 10;
  const innerWidth = Math.max(0, width - left);
  const innerHeight = Math.max(0, height - bottom - top);
  const span = max - min || 1;

  return {
    width,
    height,
    left,
    top,
    innerWidth,
    innerHeight,
    min,
    max,
    ticks,
    y: (value) => top + innerHeight - ((value - min) / span) * innerHeight,
    x: (index, n) => left + (innerWidth / n) * (index + 0.5),
    bandWidth: (n) => innerWidth / n,
  };
}
