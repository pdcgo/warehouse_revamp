import { withMarkup } from "../../lib/markup";
import type { OwnerStockRow } from "./adapt";

// ANOTHER TEAM'S COST, INVENTED — so its card can show the cross price the owner asked for (`discover-shows-the-cross-
// price`) before a cross-team read of what a product costs exists. ⚠ SAMPLE: wherever it shows it carries the page's own
// `crossPrice` mark — the Discover card's and the discover detail's (each page's pending.ts). Seeded by the product id, so
// a product shows the same figure on every visit, on its card and on its page, and in every story.
//
// The cost is invented; the MARKUP on top of it is the product's real one, so a product its owner marks up 15% reads
// 15% dearer than its cost here too.

/**
 * ANOTHER TEAM'S STOCK, INVENTED — ready and on its way (`cardStock`). OwnerStockByIds answers only for the caller's own
 * goods, and nothing reads another team's per product for a page. Every seventh has none ready and every fifth is
 * running low (1–4), so both highlights are in the grid (a-discover-card-highlights-low-stock).
 */
export function sampleStock(productId: bigint): { ready: bigint; ongoing: bigint } {
  const n = Number(productId % 9973n);

  return {
    ready: n % 7 === 0 ? 0n : n % 5 === 0 ? BigInt(1 + (n % 4)) : BigInt(8 + ((n * 13) % 140)),
    ongoing: n % 3 === 0 ? BigInt(6 + (n % 30)) : 0n,
  };
}

/**
 * ANOTHER TEAM'S STOCK ON ITS WAY, IN ONE WAREHOUSE'S LENS — the card's invented figure (`sampleStock`), all of it bound
 * for the FIRST warehouse in id order, so the lens's figures add up to Info's: every warehouse (0n) says the whole of it,
 * that one says the whole of it, every other says 0.
 */
export function sampleOngoingAt(productId: bigint, warehouseId: bigint, warehouseIds: bigint[]): bigint {
  const total = sampleStock(productId).ongoing;

  if (warehouseId === 0n) return total;
  const first = warehouseIds.reduce<bigint | undefined>((a, b) => (a === undefined || b < a ? b : a), undefined);

  return warehouseId === first ? total : 0n;
}

/** Prioritas · Riset · Umum. */
export type ProductDivision = "priority" | "research" | "general";

/**
 * A PRODUCT'S DIVISION, INVENTED (`divisionBadge`) — it is set per product and stored nowhere yet. Not every product has
 * one (owner: *"pembagian ini tidak ada semua produk"*), so a quarter carry no badge.
 */
export function sampleDivision(productId: bigint): ProductDivision | undefined {
  return (["priority", "research", "general", undefined] as const)[Number(productId % 4n)];
}

/** A plausible unit cost range for a product — one price, or two a few thousand apart. */
export function sampleCostRange(productId: bigint): { min: bigint; max: bigint } {
  const n = Number(productId % 9973n);
  const min = BigInt(8 + (n % 83)) * 1_000n; // Rp 8.000 … Rp 90.000
  const spread = n % 3 === 0 ? 0n : BigInt(1 + (n % 4)) * 500n; // a third of them have a single price

  return { min, max: min + spread };
}

/** A price range, both ends. */
export interface PriceRange {
  min: bigint;
  max: bigint;
}

/**
 * WHAT A DISCOVER READER PAYS, and on the team's own products what it cost (`discover-shows-the-cross-price`) — ONE rule,
 * read by the card's price and the discover detail's Info, so the two never say different figures for one product.
 *
 *   own, costed        the real cost (OwnerStockByIds) and the cross price over it — `sample: false`
 *   own, never costed  neither — a dash, never a zero it did not claim
 *   another team's     an invented cost (`sampleCostRange`) with the product's REAL markup over it — `sample: true`
 */
export function discoverPriceOf(
  productId: bigint,
  markupBps: number,
  own: boolean,
  stock?: OwnerStockRow,
): { cross?: PriceRange; cost?: PriceRange; sample: boolean } {
  if (own) {
    if (stock?.costKnown !== true) {
      return { sample: false };
    }

    return {
      cross: { min: withMarkup(stock.costMin, markupBps), max: withMarkup(stock.costMax, markupBps) },
      cost: { min: stock.costMin, max: stock.costMax },
      sample: false,
    };
  }

  const sample = sampleCostRange(productId);

  return { cross: { min: withMarkup(sample.min, markupBps), max: withMarkup(sample.max, markupBps) }, sample: true };
}

/**
 * ANOTHER TEAM'S CROSS PRICE IN EACH WAREHOUSE, INVENTED (each-warehouse-says-ready-and-its-price) — the product's sample
 * cost range (`sampleCostRange`, the card's) SHARED OUT among the warehouses that hold it, in id order: each gets one
 * slice, so their prices differ and the slices together are the whole range the card and Info say. One warehouse
 * holding it gets the whole range; a product of one price is one price everywhere. A warehouse not in `stocked` holds
 * none and has no price.
 */
export function sampleWarehouseCross(
  productId: bigint,
  markupBps: number,
  stocked: bigint[],
): Map<string, PriceRange> {
  const { min, max } = sampleCostRange(productId);
  const ids = [...stocked].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const k = BigInt(ids.length);
  const at = (j: bigint) => min + ((max - min) * j) / k;

  return new Map(
    ids.map((id, i) => {
      const lo = at(BigInt(i));
      const hi = at(BigInt(i + 1));

      return [id.toString(), { min: withMarkup(lo, markupBps), max: withMarkup(hi, markupBps) }];
    }),
  );
}
