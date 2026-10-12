import type { SupplierChannelRecord } from "./adapt";

// ⚠ SAMPLE — INVENTED ROWS, for the Products tab's layout only. Every page that shows them carries a `sample`
// mark of its own (pages/supplier-detail/pending.ts, pages/supplier-discover-detail/pending.ts).
//
// A supplier's products hang off its channels (products-hang-off-a-channel), but how a product gets linked to
// a channel is deferred (linking-products-is-deferred), so nothing on any server says which products a
// supplier sells. These rows are made up from the supplier's REAL channels, so the tab can be judged now —
// and are deleted the day the linking is designed.

export interface SampleProduct {
  key: string;
  name: string;
  sku: string;
  channel: SupplierChannelRecord;
}

// Shared with sampleFigures.ts, so the Statistics tab's products are the Products tab's.
export const CATALOGUE: [name: string, sku: string][] = [
  ["Kain Katun Jepang 1 rol", "KTN-JP-01"],
  ["Benang Polyester 40/2", "BNG-PL-40"],
  ["Kain Rayon Twill 1 rol", "RYN-TW-01"],
  ["Kancing Kemeja 12 mm (1 gross)", "KCG-12"],
  ["Resleting 20 cm (1 lusin)", "RSL-20"],
  ["Kain Linen Premium 1 rol", "LNN-PR-01"],
];

/** Two invented products per channel, the same two every time for the same channels. */
export function sampleProductsFor(channels: SupplierChannelRecord[]): SampleProduct[] {
  return channels.flatMap((channel, i) =>
    [0, 1].map((j) => {
      const [name, sku] = CATALOGUE[(i * 2 + j) % CATALOGUE.length]!;

      return { key: `${channel.id}-${j}`, name, sku, channel };
    }),
  );
}
