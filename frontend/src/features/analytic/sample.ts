// ⚠ SAMPLE — INVENTED ROWS, for every metric no service answers yet (pages/analytic/pending.ts marks them). The five
// ORDER metrics are served by selling_service in the app; their facts here are what the Storybook stub answers
// OrderAnalyticService with, so a story reads stable numbers through the wire. Delete this file the day every metric
// is served.
//
// The rows are generated, not typed: one fact per day per shop / product, from 2025-01-01 to today, drawn from a seeded
// hash so every run — and every story — sees the same numbers for the same window.
//
// Two shops are shaped on purpose, from the owner's own example (rpc_provide.md §Example Use Case In UI):
//   Toko Satria   many cheap orders, and NO settlement yet — sorted by Profit, it is not a row
//   Toko Lama     NO orders, but settlement still arriving — sorted by Profit, it appears
// That is the-rows-are-the-keys-step-one-sends made visible: the service that ranks decides the rows.

import { toDateInputValue } from "../../lib/datetime";
import { daySpine } from "../../lib/period";

export interface SampleEntity {
  id: string;
  name: string;
}

export interface SampleProduct extends SampleEntity {
  supplier: string;
  price: number;
}

export const SAMPLE_SHOPS: SampleEntity[] = [
  { id: "11", name: "Toko Maryam" },
  { id: "12", name: "Toko Baru Segu" },
  { id: "13", name: "Toko Satria" },
  { id: "14", name: "Toko Lama" },
  { id: "15", name: "Toko Melati" },
  { id: "16", name: "Toko Sinar" },
];

export const SAMPLE_SUPPLIERS: SampleEntity[] = [
  { id: "31", name: "CV Sumber Jaya" },
  { id: "32", name: "PT Kain Nusantara" },
  { id: "33", name: "UD Plastik Makmur" },
];

export const SAMPLE_PRODUCTS: SampleProduct[] = [
  { id: "201", name: "Kaos Polos Hitam", supplier: "32", price: 45_000 },
  { id: "202", name: "Kemeja Flanel", supplier: "32", price: 120_000 },
  { id: "203", name: "Botol Minum 1L", supplier: "33", price: 6_500 },
  { id: "204", name: "Kotak Makan", supplier: "33", price: 7_000 },
  { id: "205", name: "Sepatu Kanvas", supplier: "31", price: 180_000 },
  { id: "206", name: "Tas Selempang", supplier: "31", price: 95_000 },
];

/** What each shop sells, and how often a day has an order for it. Toko Lama sells nothing in this window. */
const SHOP_PROFILE: Record<string, { products: string[]; chance: number; most: number; settlement: number }> = {
  "11": { products: ["202", "205", "206"], chance: 0.35, most: 3, settlement: 1_500_000 },
  "12": { products: ["201", "203"], chance: 0.3, most: 3, settlement: 300_000 },
  "13": { products: ["203", "204"], chance: 0.85, most: 4, settlement: 0 },
  "14": { products: [], chance: 0, most: 0, settlement: 600_000 },
  "15": { products: ["201", "202", "206"], chance: 0.35, most: 3, settlement: 800_000 },
  "16": { products: ["204", "205"], chance: 0.3, most: 2, settlement: 400_000 },
};

/** The shops that buy ads. */
const ADS_SHOPS = ["11", "12", "15"];

const SAMPLE_START = "2025-01-01";

/** One day's figures for one shop, product or supplier — or for the whole team, when none is named. */
export interface Fact {
  day: string;
  shop?: string;
  product?: string;
  supplier?: string;
  /** The seller, the warehouse that ships and the order's creator — the order metrics' other keys. */
  team?: string;
  warehouse?: string;
  user?: string;
  values: Record<string, number>;
}

/**
 * THE ORDER FACTS' SELLER, WAREHOUSE AND CREATORS — the Storybook fixtures' own: Toko Melati (12) sells, Gudang Pusat
 * (11) ships, and three of its people place the orders, so a story grouped by team, warehouse or user names real rows.
 */
export const SAMPLE_SELLER = "12";
export const SAMPLE_WAREHOUSE = "11";
const SAMPLE_CREATORS = ["61", "62", "65"];

/** What the platform says the buyer paid, for a figure we priced at `total` — a little above our cost. */
const mpOf = (total: number) => Math.round(total * 1.12);

/** The four moves after a placement, each a chance per placed order, counted on the placement's day for the sample. */
const ORDER_MOVES: { metricId: string; prefix: string; mp: string; chance: number }[] = [
  { metricId: "metrics/orders/cancelled", prefix: "cancel", mp: "mp_total", chance: 0.08 },
  { metricId: "metrics/orders/return_created", prefix: "return_created", mp: "return_created_mp_total", chance: 0.05 },
  { metricId: "metrics/orders/return_arrived", prefix: "return_arrived", mp: "return_arrived_mp_total", chance: 0.03 },
  { metricId: "metrics/orders/lost_created", prefix: "lost_created", mp: "lost_created_mp_total", chance: 0.01 },
];

/** A number in [0, 1), the same for the same seed on every run — FNV-1a, then an avalanche. */
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;

  return (h >>> 0) / 4294967296;
}

function build(): Record<string, Fact[]> {
  const days = daySpine(SAMPLE_START, toDateInputValue(new Date()));
  const facts: Record<string, Fact[]> = {
    "metrics/orders/created": [],
    ...Object.fromEntries(ORDER_MOVES.map((m) => [m.metricId, []])),
    "metrics/settlement": [],
    "metrics/inventory/lost": [],
    "metrics/ads": [],
    "metrics/expenses": [],
  };

  for (const day of days) {
    for (const shop of SAMPLE_SHOPS) {
      const profile = SHOP_PROFILE[shop.id]!;

      for (const productId of profile.products) {
        if (seeded(`o|${day}|${shop.id}|${productId}`) >= profile.chance) continue;

        const product = SAMPLE_PRODUCTS.find((p) => p.id === productId)!;
        const count = 1 + Math.floor(seeded(`oc|${day}|${shop.id}|${productId}`) * profile.most);
        const total = count * product.price;
        const who = {
          day,
          shop: shop.id,
          team: SAMPLE_SELLER,
          warehouse: SAMPLE_WAREHOUSE,
          user: SAMPLE_CREATORS[Number(shop.id) % SAMPLE_CREATORS.length]!,
        };

        facts["metrics/orders/created"]!.push({
          ...who,
          values: { created_count: count, created_total: total, mp_total: mpOf(total) },
        });

        for (const move of ORDER_MOVES) {
          if (seeded(`${move.prefix}|${day}|${shop.id}|${productId}`) >= move.chance) continue;

          facts[move.metricId]!.push({
            ...who,
            values: {
              [`${move.prefix}_count`]: 1,
              [`${move.prefix}_total`]: product.price,
              [move.mp]: mpOf(product.price),
            },
          });
        }
      }

      if (profile.settlement > 0 && seeded(`s|${day}|${shop.id}`) < 0.5) {
        const amount = Math.round(profile.settlement * (0.4 + seeded(`sa|${day}|${shop.id}`)));
        // Mostly a margin; now and then a return or a fee eats more than the sale brought.
        const loss = seeded(`sl|${day}|${shop.id}`) < 0.08 ? amount * 0.5 : 0;
        const profit = Math.round(amount * (0.1 + 0.2 * seeded(`sp|${day}|${shop.id}`)) - loss);
        facts["metrics/settlement"]!.push({ day, shop: shop.id, values: { settlement_amount: amount, profit } });
      }

      if (ADS_SHOPS.includes(shop.id) && seeded(`a|${day}|${shop.id}`) < 0.6) {
        const spend = Math.round(20_000 + 130_000 * seeded(`as|${day}|${shop.id}`));
        facts["metrics/ads"]!.push({ day, shop: shop.id, values: { ads_spend: spend } });
      }
    }

    for (const product of SAMPLE_PRODUCTS) {
      if (seeded(`l|${day}|${product.id}`) >= 0.06) continue;

      const lost = 1 + Math.floor(seeded(`lc|${day}|${product.id}`) * 3);
      facts["metrics/inventory/lost"]!.push({
        day,
        product: product.id,
        supplier: product.supplier,
        values: { lost_count: lost, lost_amount: lost * product.price },
      });
    }

    if (seeded(`e|${day}`) < 0.3) {
      facts["metrics/expenses"]!.push({ day, values: { expense_total: Math.round(50_000 + 450_000 * seeded(`ea|${day}`)) } });
    }
  }

  return facts;
}

let cache: Record<string, Fact[]> | undefined;

/** Every invented fact of one metric. Built once per page load. */
export function sampleFacts(metricId: string): Fact[] {
  cache ??= build();

  return cache[metricId] ?? [];
}

/** The name of a shop, product or supplier — what the real screen will ask ShopByIds, ProductByIds, SupplierByIds. */
export function sampleName(kind: "shop" | "product" | "supplier", id: string): string {
  const list = kind === "shop" ? SAMPLE_SHOPS : kind === "product" ? SAMPLE_PRODUCTS : SAMPLE_SUPPLIERS;

  return list.find((e) => e.id === id)?.name ?? `#${id}`;
}
