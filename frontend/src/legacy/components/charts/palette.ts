import { useColorMode } from "../../../lib/colorMode";

// ── THE CHART SERIES PALETTE ────────────────────────────────────────────────────────────────────
//
// Eight hues in a FIXED ORDER. Series 1 is always blue, series 2 always orange, and so on.
//
// ⚠ THE ORDER IS THE SAFETY MECHANISM, NOT A STYLE CHOICE. It was chosen so that every ADJACENT
// pair stays distinguishable under colour-vision deficiency — the pairs that actually sit beside
// each other in a stack, a grouped bar or a legend. Re-ordering these, or inserting a hue, breaks
// that property silently: the chart still renders, it is just no longer readable by everyone.
//
// Both columns are SELECTED, not computed. The dark values are the same eight hues re-stepped for a
// dark surface — an automatic lightness flip would push several of them below the contrast floor.
//
// Validated (OKLab ΔE ×100, adjacent pairs):
//   light — CVD worst 9.1, normal-vision worst 19.6, surface #fcfcfb
//   dark  — CVD worst 8.4, normal-vision worst 19.3, surface #1a1a19
//
// ⚠ THREE LIGHT-MODE HUES SIT BELOW 3:1 AGAINST THE LIGHT SURFACE (aqua, yellow, magenta). That is
// permitted only with RELIEF — the mark must never be the only way to identify a series. Both charts
// here ship a legend and a hover tooltip naming the series, which is what discharges it. Remove
// those and the palette stops being compliant.
const SERIES_LIGHT = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
];

const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

// The most series either chart will colour. Past this there is no ninth hue to reach for — a
// generated one would not have been validated against its neighbours.
//
// ⚠ NEVER CYCLE BACK TO SLOT 1. Two series in the same colour is worse than no chart: the reader has
// no way to know the legend is lying. A ninth series means folding the tail into "Other", faceting
// into small multiples, or filtering — all of which are decisions for the caller, which is why this
// is exported rather than silently enforced.
export const MAX_SERIES = SERIES_LIGHT.length;

// useSeriesColors returns the palette for the CURRENT colour mode.
//
// A hook rather than a constant because the two columns are different palettes, not a filter over
// one: reading the light values in dark mode puts three of them under the contrast floor.
export function useSeriesColors(): string[] {
  return useColorMode() === "dark" ? SERIES_DARK : SERIES_LIGHT;
}

// The colour for one series index. Returns undefined past the cap rather than wrapping — see above.
export function seriesColor(colors: string[], index: number): string | undefined {
  return colors[index];
}
