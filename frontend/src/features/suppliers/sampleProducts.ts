import type { SupplierChannelRecord } from "./adapt";

// ⚠ SAMPLE — INVENTED ROWS, for the Products tab's layout only. Every page that shows them carries a `sample`
// mark of its own (pages/supplier-detail/pending.ts, pages/supplier-discover-detail/pending.ts).
//
// A supplier's products hang off its channels (products-hang-off-a-channel): an accepted restock line links the
// RESTOCKING team's product to the store it was bought at (every-accepted-line-links-its-own-product), and the link
// remembers its first and its last restock (a-link-remembers-its-last-restock). Neither the link table nor a read of
// it exists yet, so these rows are made up from the supplier's REAL channels, so the tab can be judged now — and are
// deleted the day the link is built.

export interface SampleProduct {
  key: string;
  id: bigint;
  name: string;
  sku: string;
  /** The list-sized picture — "" when the product has none, and the shared item draws its placeholder. */
  thumbnailUrl: string;
  /** The team that restocked it — whose product it is. Two teams buying one item are two rows. */
  teamId: bigint;
  teamName: string;
  /** The link's `created_at` and `last_restocked_at`, unix seconds. */
  firstBoughtAt: bigint;
  lastBoughtAt: bigint;
  channel: SupplierChannelRecord;
}

// A flat swatch standing in for a product photo — a colour and a weave of stripes, so the cover reads as a picture.
function swatch(base: string, stripe: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${base}"/>` +
    `<path d="M-16 16 16-16M-16 48 48-16M-16 80 80-16M16 80 80 16M48 80 80 48" stroke="${stripe}" stroke-width="6"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CATALOGUE: [name: string, sku: string, thumbnailUrl: string][] = [
  ["Kain Katun Jepang 1 rol", "KTN-JP-01", swatch("#bfdbfe", "#93c5fd")],
  ["Benang Polyester 40/2", "BNG-PL-40", swatch("#fde68a", "#fbbf24")],
  ["Kain Rayon Twill 1 rol", "RYN-TW-01", swatch("#fecdd3", "#fda4af")],
  // No picture — a product may have none, and the placeholder is worth seeing.
  ["Kancing Kemeja 12 mm (1 gross)", "KCG-12", ""],
  ["Resleting 20 cm (1 lusin)", "RSL-20", swatch("#d1d5db", "#9ca3af")],
  ["Kain Linen Premium 1 rol", "LNN-PR-01", swatch("#e7e5e4", "#d6d3d1")],
];

// Two selling teams, so the Team column and the team filter have something to tell apart — the Storybook teams, so
// the filter (the selling teams the stub lists) finds them.
const TEAMS: [id: bigint, name: string][] = [
  [12n, "Toko Melati"],
  [13n, "Toko Kenanga"],
];

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);

/** Two invented products per channel, the same every time for the same channels — newest restock first. */
export function sampleProductsFor(channels: SupplierChannelRecord[]): SampleProduct[] {
  const rows = channels.flatMap((channel, i) =>
    [0, 1].map((j) => {
      const k = i * 2 + j;
      const [name, sku, thumbnailUrl] = CATALOGUE[k % CATALOGUE.length]!;
      const lastBoughtAt = LATEST - BigInt(k * 9) * DAY;
      // Every third one was bought once, so its first restock is its last.
      const firstBoughtAt = k % 3 === 2 ? lastBoughtAt : lastBoughtAt - BigInt(30 + k * 17) * DAY;

      return {
        key: `${channel.id}-${j}`,
        id: BigInt(k + 1),
        name,
        sku,
        thumbnailUrl,
        teamId: TEAMS[k % 3 === 1 ? 1 : 0]![0],
        teamName: TEAMS[k % 3 === 1 ? 1 : 0]![1],
        firstBoughtAt,
        lastBoughtAt,
        channel,
      };
    }),
  );

  // a-link-remembers-its-last-restock: newest first, so a store that stopped selling something sinks to the bottom.
  return rows.sort((a, b) => (a.lastBoughtAt === b.lastBoughtAt ? 0 : a.lastBoughtAt > b.lastBoughtAt ? -1 : 1));
}
