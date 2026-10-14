import type { SupplierFigures } from "./figures";

// ⚠ SAMPLE — INVENTED SALES, for *Penjualan* beside *Direstok* on the Statistik tab and the Supplier Report
// (`sales-sit-beside-restocked`). The supplier figures count what came IN from a supplier; nothing yet counts what went
// OUT of it to a buyer, so each page that shows this marks it `sample`. Deleted the day the read exists.
//
// Drawn from the same row's restock at ONE fixed ratio — four in five of the units restocked, sold at 30% over their
// cost — so a card's total is its rows' sum, as Direstok's is. A ratio that varied by row read as a card that did not
// add up to the table under it.

const SOLD_SHARE = 0.8;
const MARKUP = 1.3;

export interface SampleSales {
  count: number;
  value: bigint;
}

export function sampleSalesFrom(figures: SupplierFigures): SampleSales {
  if (figures.restockCount === 0) return { count: 0, value: 0n };

  return {
    count: Math.max(1, Math.round(figures.restockCount * SOLD_SHARE)),
    // Rounded to Rp 500, as a price is.
    value: BigInt(Math.round((Number(figures.restockValue) * SOLD_SHARE * MARKUP) / 500) * 500),
  };
}
