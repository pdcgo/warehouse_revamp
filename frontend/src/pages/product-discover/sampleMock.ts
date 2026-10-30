// ANOTHER TEAM'S COST, INVENTED — so its card can show the cross price the owner asked for (`discover-shows-the-cross-
// price`) before a cross-team read of what a product costs exists. ⚠ SAMPLE: the card's price carries the `crossPrice`
// mark (pending.ts). Seeded by the product id, so a card shows the same figure on every visit and in every story.
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
