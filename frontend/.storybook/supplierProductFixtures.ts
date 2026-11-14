// A SUPPLIER'S PRODUCTS for Storybook's supplier stub — the links an accepted restock writes (supplier_channel_products),
// each with the product as product_service names it and its store × product Terjual and Siap as inventory counts them,
// the shape SupplierChannelService.SupplierProductList answers (`products-hang-off-a-channel`,
// `a-link-remembers-its-last-restock`, `the-detail-tabs-show-sold-and-ready`).
//
//   PT Sumber Makmur (31, Toko Melati's)  five products: two teams, one bought twice at one store (Shopee), one with NO
//                                         store (a-line-with-no-store-links-under-the-supplier), one bought once, one
//                                         whose goods never arrived (no figures), one with no picture. Under the
//                                         Gudang Pusat chip (11) the two Shopee rows; under Gudang Cabang (14) the
//                                         Tokopedia row and the store-less one.
//   PT Banyak Toko (35)                   two per store over its twelve — 24 rows, three pages of ten.
//   PT Tekstil Nusantara (36, Anggrek's)  read from Discover by another team: Toko Melati's and Toko Anggrek's.
//
// Dates are DAYS AGO from the story's run, so "newest first" and the dates a story reads stay true whatever the day.

export interface SupplierProductFixture {
  id: bigint;
  supplierId: bigint;
  productId: bigint;
  teamId: bigint;
  /** The store it was bought at; 0n = none. */
  channelId: bigint;
  /** The first and the last restock, days ago. */
  firstDaysAgo: number;
  lastDaysAgo: number;
  /** null = none of its goods arrived. */
  figures: { sold: number; orders: number; lastOrderDaysAgo: number | null; ready: number } | null;
  /**
   * The warehouses its goods were received at — a supplier page's Gudang terkait chip keeps the row only there
   * (a-supplier-page-is-scoped-by-its-warehouses). Absent = where the goods stub holds a lot for its supplier and store.
   * Each row here sits at one warehouse, so its figures there are its whole.
   */
  warehouses?: bigint[];
}

export interface CatalogueProduct {
  name: string;
  productCode: string;
  /** "" = no picture — the shared item draws its placeholder. */
  thumbnailUrl: string;
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

/** The products the links name — product_service's answer, by id. */
export const productCatalogue: Record<string, CatalogueProduct> = {
  "501": { name: "Kain Katun Jepang 1 rol", productCode: "KTN-JP-01", thumbnailUrl: swatch("#bfdbfe", "#93c5fd") },
  "502": { name: "Benang Polyester 40/2", productCode: "BNG-PL-40", thumbnailUrl: swatch("#fde68a", "#fbbf24") },
  "503": { name: "Kain Rayon Twill 1 rol", productCode: "RYN-TW-01", thumbnailUrl: swatch("#fecdd3", "#fda4af") },
  // No picture — a product may have none, and the placeholder is worth seeing.
  "504": { name: "Kancing Kemeja 12 mm (1 gross)", productCode: "KCG-12", thumbnailUrl: "" },
  "505": { name: "Resleting 20 cm (1 lusin)", productCode: "RSL-20", thumbnailUrl: swatch("#d1d5db", "#9ca3af") },
  "506": { name: "Kain Linen Premium 1 rol", productCode: "LNN-PR-01", thumbnailUrl: swatch("#e7e5e4", "#d6d3d1") },
  "507": { name: "Beras Pandan Wangi 5 kg", productCode: "BRS-PW-05", thumbnailUrl: swatch("#fef3c7", "#fde68a") },
};

const link = (
  id: number,
  supplierId: number,
  productId: number,
  teamId: number,
  channelId: number,
  firstDaysAgo: number,
  lastDaysAgo: number,
  figures: SupplierProductFixture["figures"],
): SupplierProductFixture => ({
  id: BigInt(id),
  supplierId: BigInt(supplierId),
  productId: BigInt(productId),
  teamId: BigInt(teamId),
  channelId: BigInt(channelId),
  firstDaysAgo,
  lastDaysAgo,
  figures,
});

// PT Banyak Toko's twelve stores (351–362), two products each — newest first by store, a day apart.
const banyak = Array.from({ length: 24 }, (_, i) =>
  link(3500 + i, 35, 501 + (i % 6), i % 3 === 1 ? 13 : 12, 351 + Math.floor(i / 2), 60 + i, 2 + i, {
    sold: 10 + i * 7,
    orders: 1 + i,
    lastOrderDaysAgo: 1 + i,
    ready: (i * 5) % 30,
  }),
);

export const supplierProductFixtures: SupplierProductFixture[] = [
  // PT Sumber Makmur — Shopee (311): Toko Melati's katun, bought twice, sold and on the shelf.
  link(3101, 31, 501, 12, 311, 40, 2, { sold: 412, orders: 31, lastOrderDaysAgo: 1, ready: 37 }),
  // …and Toko Kenanga's benang at the same store — another team, another row; bought ONCE, nothing sold yet.
  link(3102, 31, 502, 13, 311, 5, 5, { sold: 0, orders: 0, lastOrderDaysAgo: null, ready: 24 }),
  // Tokopedia (312): sold out — 0 ready.
  link(3103, 31, 503, 12, 312, 60, 9, { sold: 128, orders: 12, lastOrderDaysAgo: 3, ready: 0 }),
  // NO STORE — a restock line named the supplier alone; its Toko reads "—" (a-line-with-no-store-links-under-the-supplier).
  // Received at Gudang Cabang (14).
  { ...link(3104, 31, 504, 12, 0, 30, 14, { sold: 60, orders: 4, lastOrderDaysAgo: 10, ready: 15 }), warehouses: [14n] },
  // The website (313): every unit broke on the way — none of its goods arrived, so no figures, and no warehouse holds it.
  { ...link(3105, 31, 505, 13, 313, 20, 20, null), warehouses: [] },
  ...banyak,
  // PT Tekstil Nusantara — Toko Anggrek's supplier, read from Discover by Toko Melati.
  link(3601, 36, 507, 12, 371, 25, 4, { sold: 90, orders: 9, lastOrderDaysAgo: 2, ready: 11 }),
  link(3602, 36, 506, 15, 372, 50, 12, { sold: 33, orders: 5, lastOrderDaysAgo: 6, ready: 7 }),
];
