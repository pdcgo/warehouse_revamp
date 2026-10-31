// ⚠ INVENTED ROWS FOR PRODUK TURUNAN — the link a return to another team makes between two products, which nothing
// records yet (owner: *"pemasok dan turunan yang masih kosong tolong diisi"*). Here so the SHAPE can be judged; each page
// showing it carries its own ⚠ (`derived`, `sample`). Deterministic per product, so a story and a screenshot agree — and
// the product's own page and its discover detail show the same rows (the-discover-detail-shows-no-markup).
//
// Replace with the real read the day it exists: the products a return to another team derived from this one, and the
// one this was derived from.

export interface SampleDerived {
  /** The derived product's name — the owner's product as the receiving team now carries it. */
  name: string;
  sku: string;
  /** The team the return went to, which now owns the derived product. */
  teamName: string;
  /** Its stock ready on a shelf, in that team — not how many came back. */
  readyQty: number;
  /** Its picture — the sample lends it the product's own, as a derived product starts as the same goods. */
  imageUrl: string;
}

const TEAMS = ["Toko Melati", "Toko Kenanga", "Toko Anggrek", "Toko Dahlia"];

/**
 * The two directions of the link a return to another team makes (owner: *"barang yang retur ke team beda team, tapi
 * masalah lain bisa jadi yang sekarang itu juga turunan"*): what this product was derived FROM — at most one — and the
 * products other teams derived FROM IT.
 */
export function sampleDerived(
  productId: bigint,
  name: string,
  sku: string,
  imageUrl: string,
): { from?: SampleDerived; to: SampleDerived[] } {
  const n = Number(productId % 97n);

  return {
    // Every third product is itself derived — the case the owner raised.
    from:
      n % 3 === 0
        ? { name, sku: `${sku}-ASAL`, teamName: "Toko Kenanga", readyQty: 18, imageUrl }
        : undefined,
    // MANY, on purpose — a product sold through several teams comes back to several (owner: *"dia bisa banyak"*), so the
    // section is judged at the length that made it confusing.
    to: Array.from({ length: 5 + (n % 4) }, (_, i) => ({
      name: `${name} (Retur)`,
      sku: `${sku}-R${i + 1}`,
      teamName: TEAMS[(n + i) % TEAMS.length]!,
      readyQty: (n + i * 3) % 7,
      imageUrl,
    })),
  };
}
