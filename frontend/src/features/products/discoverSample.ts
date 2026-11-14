import { withMarkup } from "../../lib/markup";
import type { OwnerStockRow } from "./adapt";

// WHAT DISCOVER STILL INVENTS — the division (its `divisionBadge` / `division` marks) — and the team's OWN product's
// price as the discover detail reads it. Another team's stock, on its way and cross price are REAL on the card
// (2026-11-14) and on the detail (DiscoverStockByIds, `useDiscoverStockByWarehouse`); their samples are gone.

/** Prioritas · Riset · Umum. */
export type ProductDivision = "priority" | "research" | "general";

/**
 * A PRODUCT'S DIVISION, INVENTED (`divisionBadge`) — it is set per product and stored nowhere yet. Not every product has
 * one (owner: *"pembagian ini tidak ada semua produk"*), so a quarter carry no badge.
 */
export function sampleDivision(productId: bigint): ProductDivision | undefined {
  return (["priority", "research", "general", undefined] as const)[Number(productId % 4n)];
}

/** A price range, both ends — money is a `number` (exact double) everywhere. */
export interface PriceRange {
  min: number;
  max: number;
}

/**
 * WHAT THE TEAM'S OWN PRODUCT COST, and the cross price over it (`discover-shows-the-cross-price`) — the discover
 * detail's figures for a product the team standing here owns, from its own OwnerStockByIds (the cost no other team may
 * read). Never costed: neither — a dash, never a zero it did not claim. Another team's product reads its cross price from
 * DiscoverStockByIds instead, as its card does.
 */
export function ownPriceOf(markupBps: number, stock?: OwnerStockRow): { cross?: PriceRange; cost?: PriceRange } {
  if (stock?.costKnown !== true) {
    return {};
  }

  return {
    cross: { min: withMarkup(stock.costMin, markupBps), max: withMarkup(stock.costMax, markupBps) },
    cost: { min: stock.costMin, max: stock.costMax },
  };
}
