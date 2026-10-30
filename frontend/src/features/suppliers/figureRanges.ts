// THE RANGE PILLS' BANDS — PLACEHOLDERS. Where a band's edges come from is open (owner: *"nilai range belum ditentukan
// dari mana"*), and two schemes are on the table: bands drawn from the totals, or a ready-made set. Until one is chosen
// each figure has a fixed set, wide enough to tell its sample figures apart — and nothing narrows the list by them yet
// (`supplier-figures-filter-by-range-pills`, `the-figure-filters-are-two-panels`). The supplier list and Discover share
// them (`discover-shows-the-same-figures-and-filters`).

import { units } from "./sampleSupplierFigures";

/** One band, `min` inclusive and `max` exclusive; `max: null` is open-ended. */
export interface FigureRange {
  key: string;
  min: number;
  max: number | null;
}

export type FigureRangeKind = "sold" | "ready";

const band = (min: number, max: number | null): FigureRange => ({ key: max === null ? `${min}+` : `${min}-${max}`, min, max });

export const FIGURE_RANGES: Record<FigureRangeKind, FigureRange[]> = {
  // Every unit ever sold — hundreds to thousands.
  sold: [band(0, 500), band(500, 1000), band(1000, 2500), band(2500, 5000), band(5000, null)],
  // Units ready on a shelf — tens to hundreds.
  ready: [band(0, 50), band(50, 100), band(100, 250), band(250, 500), band(500, null)],
};

/** A band as a pill reads it: `< 500`, `500–1.000`, `≥ 5.000`. */
export function rangeLabel(range: FigureRange): string {
  if (range.max === null) return `≥ ${units(range.min)}`;
  if (range.min === 0) return `< ${units(range.max)}`;
  return `${units(range.min)}–${units(range.max)}`;
}
