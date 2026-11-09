// THE RANGE PILLS' BANDS — A FIXED SET PER FIGURE (owner: *"A"*, `the-range-pills-are-a-fixed-set`), so a pill means the
// same every day and lives in the URL. A band is lower-inclusive, upper-exclusive, and the SERVER narrows the list by it
// before paging (SupplierList's `sold` / `ready`, over every team's goods). The supplier list and Discover share them
// (`discover-shows-the-same-figures-and-filters`).

import { units } from "./figureValues";

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

/**
 * The band a URL key names, as SupplierList's `SupplierFigureBand` takes it — `max` 0 is open-ended. `undefined` for
 * Semua ("") and for a key no band carries, which reads as Semua too.
 */
export function figureBand(kind: FigureRangeKind, key: string): { min: bigint; max: bigint } | undefined {
  const range = FIGURE_RANGES[kind].find((r) => r.key === key);
  if (!range) return undefined;

  return { min: BigInt(range.min), max: BigInt(range.max ?? 0) };
}

/** A band as a pill reads it: `< 500`, `500–1.000`, `≥ 5.000`. */
export function rangeLabel(range: FigureRange): string {
  if (range.max === null) return `≥ ${units(range.min)}`;
  if (range.min === 0) return `< ${units(range.max)}`;
  return `${units(range.min)}–${units(range.max)}`;
}
