// HOW A LABEL IS PRINTED — every setting, its default, and the arithmetic that lays a sticker out, in one pure place so
// the settings panel, the screen's preview and the printed page cannot disagree (owner, 2026-11-06, the settings
// `the-label-is-set-up-in-mm`):
//
//   paper      width × height in mm — default 35 × 15
//   grid       rows × columns of labels on one paper, and the gap between them — default 1 × 1, gap 0
//   padding    inside each label, the same all round or each side its own — mm, default 2
//   text       bold (default on), centred (default off), condensed (default off), the gap between the QR and the text
//   what       the main SKU, the placement, the product's name, today's date (off by default) — each its own size, in pt;
//              the name cut after N lines
//   the run    one label per piece or per placement; how many labels a run prints, and which run (limit and page)

export type PaddingMode = "all" | "sides";
export type LabelMode = "piece" | "shelf";

export interface LabelSettings {
  paperWidth: number;
  paperHeight: number;
  rows: number;
  columns: number;
  gap: number;
  paddingMode: PaddingMode;
  padding: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  bold: boolean;
  center: boolean;
  condensed: boolean;
  qrGap: number;
  showSku: boolean;
  showPlacement: boolean;
  showName: boolean;
  showDate: boolean;
  skuSize: number;
  placementSize: number;
  nameSize: number;
  dateSize: number;
  nameLines: number;
  mode: LabelMode;
  limit: number;
}

export const DEFAULT_SETTINGS: LabelSettings = {
  paperWidth: 35,
  paperHeight: 15,
  rows: 1,
  columns: 1,
  gap: 0,
  paddingMode: "all",
  padding: 2,
  paddingTop: 2,
  paddingRight: 2,
  paddingBottom: 2,
  paddingLeft: 2,
  bold: true,
  center: false,
  condensed: false,
  qrGap: 1.5,
  showSku: true,
  showPlacement: true,
  showName: true,
  showDate: false,
  // Sizes that fit a 35 × 15 mm paper with its 13 mm QR beside them: a 12-character SKU whole at 5.5 pt bold, the
  // placement — what is read from a step away — larger, the name's two lines under them.
  skuSize: 5.5,
  placementSize: 7,
  nameSize: 5.5,
  dateSize: 5,
  nameLines: 2,
  mode: "piece",
  limit: 100,
};

/** The bounds each number is held to — a typo cannot make a 0 mm paper or a 900 pt name. */
export const BOUNDS = {
  paper: { min: 10, max: 300 },
  grid: { min: 1, max: 20 },
  gap: { min: 0, max: 20 },
  padding: { min: 0, max: 20 },
  qrGap: { min: 0, max: 20 },
  font: { min: 3, max: 36 },
  nameLines: { min: 1, max: 5 },
  limit: { min: 1, max: 1000 },
} as const;

// v3: only what was CHANGED is stored (saveSettings) — v1 and v2 stored every setting the moment the page opened, so a
// later default (35 × 15 mm, padding 2 mm) never reached a device that had opened it once.
const STORAGE_KEY = "restock-labels.settings.v3";

function clamp(n: unknown, { min, max }: { min: number; max: number }, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

/** Any stored or typed object, held to the bounds — an older or hand-edited value never breaks the page. */
export function normalise(raw: Partial<LabelSettings> | null | undefined): LabelSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  const d = DEFAULT_SETTINGS;

  return {
    paperWidth: clamp(s.paperWidth, BOUNDS.paper, d.paperWidth),
    paperHeight: clamp(s.paperHeight, BOUNDS.paper, d.paperHeight),
    rows: Math.round(clamp(s.rows, BOUNDS.grid, d.rows)),
    columns: Math.round(clamp(s.columns, BOUNDS.grid, d.columns)),
    gap: clamp(s.gap, BOUNDS.gap, d.gap),
    paddingMode: s.paddingMode === "sides" ? "sides" : "all",
    padding: clamp(s.padding, BOUNDS.padding, d.padding),
    paddingTop: clamp(s.paddingTop, BOUNDS.padding, d.paddingTop),
    paddingRight: clamp(s.paddingRight, BOUNDS.padding, d.paddingRight),
    paddingBottom: clamp(s.paddingBottom, BOUNDS.padding, d.paddingBottom),
    paddingLeft: clamp(s.paddingLeft, BOUNDS.padding, d.paddingLeft),
    bold: typeof s.bold === "boolean" ? s.bold : d.bold,
    center: typeof s.center === "boolean" ? s.center : d.center,
    condensed: typeof s.condensed === "boolean" ? s.condensed : d.condensed,
    qrGap: clamp(s.qrGap, BOUNDS.qrGap, d.qrGap),
    showSku: typeof s.showSku === "boolean" ? s.showSku : d.showSku,
    showPlacement: typeof s.showPlacement === "boolean" ? s.showPlacement : d.showPlacement,
    showName: typeof s.showName === "boolean" ? s.showName : d.showName,
    showDate: typeof s.showDate === "boolean" ? s.showDate : d.showDate,
    skuSize: clamp(s.skuSize, BOUNDS.font, d.skuSize),
    placementSize: clamp(s.placementSize, BOUNDS.font, d.placementSize),
    nameSize: clamp(s.nameSize, BOUNDS.font, d.nameSize),
    dateSize: clamp(s.dateSize, BOUNDS.font, d.dateSize),
    nameLines: Math.round(clamp(s.nameLines, BOUNDS.nameLines, d.nameLines)),
    mode: s.mode === "shelf" ? "shelf" : "piece",
    limit: Math.round(clamp(s.limit, BOUNDS.limit, d.limit)),
  };
}

/**
 * REMEMBERED ON THIS DEVICE (the-label-settings-are-remembered) — a warehouse prints on the same stickers every day, so
 * fifteen settings typed again per run would be a tax. Browser storage, per device: it can be missing or refuse, and the
 * page then simply starts from the defaults.
 */
export function loadSettings(): LabelSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalise(raw ? (JSON.parse(raw) as Partial<LabelSettings>) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Store only what differs from the defaults — so a setting nobody touched follows the defaults as they change, and an
 * untouched page stores nothing at all.
 */
export function saveSettings(settings: LabelSettings) {
  try {
    const changed = Object.fromEntries(
      Object.entries(settings).filter(([key, value]) => DEFAULT_SETTINGS[key as keyof LabelSettings] !== value),
    );
    if (Object.keys(changed).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // Storage refused (a private window, blocked site data) — the settings still hold for this visit.
  }
}

export function clearSettings() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function paddingOf(s: LabelSettings): Padding {
  return s.paddingMode === "all"
    ? { top: s.padding, right: s.padding, bottom: s.padding, left: s.padding }
    : { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft };
}

/** One label's box on the paper, its QR's side and its text column's width — all mm. */
export interface LabelBox {
  width: number;
  height: number;
  qr: number;
  text: number;
}

export function labelBox(s: LabelSettings): LabelBox {
  const width = Math.max(0, (s.paperWidth - s.gap * (s.columns - 1)) / s.columns);
  const height = Math.max(0, (s.paperHeight - s.gap * (s.rows - 1)) / s.rows);
  const pad = paddingOf(s);
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = Math.max(0, height - pad.top - pad.bottom);
  // The QR is a square as tall as the label's inside, never wider than half of it — the text needs room too.
  const qr = Math.min(innerH, innerW / 2);
  const text = Math.max(0, innerW - qr - s.qrGap);

  return { width, height, qr, text };
}

/** The run: which labels this print sends — `limit` of them, the `page`-th run — and how many runs there are. */
export function runOf<T>(job: T[], limit: number, page: number): { items: T[]; pages: number; page: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(job.length / limit));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * limit;
  const items = job.slice(start, start + limit);

  return { items, pages, page: p, from: items.length ? start + 1 : 0, to: start + items.length };
}

/** The run's labels cut into papers — rows × columns each. */
export function papersOf<T>(items: T[], s: LabelSettings): T[][] {
  const per = s.rows * s.columns;
  const papers: T[][] = [];
  for (let i = 0; i < items.length; i += per) papers.push(items.slice(i, i + per));
  return papers;
}

/** 1 mm in CSS px — what the preview's scale is worked out from. */
export const PX_PER_MM = 96 / 25.4;
