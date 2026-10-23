import { daysAgo, products, users } from "./fixtures";

// Toko Melati's (team 12) bundles, and one of Toko Kenanga's — the picking recipes the Bundles screens show
// (docs/business/product/product_bundle_decision.md). Every rule has a row that makes it visible:
//
//   bundle-names-may-repeat                     two "Paket Hemat", told apart only by what is in them
//   a-borrowed-product-never-blocks-its-owner   Gula Pasir is Kenanga's and Minyak Goreng is Anggrek's — borrowed lines;
//                                               a story locks or archives one (productScenario.ts) to show the line go
//                                               unavailable
//   the-creator-or-an-admin-edits-a-bundle      Ani (61, the signed-in person) made some, Budi (62) the others — so a
//                                               story standing as a CS sees both sides
//   a-bundle-has-at-least-one-line              the 3-pack is ONE line, quantity 3
//
// ⚠ APPEND, never reorder — stories name these by `bundleFixture(name, creator)`, not by position, but a new bundle
// at the front would still change which one sorts first.

export interface BundleFixture {
  id: bigint;
  teamId: bigint;
  name: string;
  description: string;
  createdByUserId: bigint;
  createdAtUnix: bigint;
  updatedAtUnix: bigint;
  lines: { productId: bigint; quantity: number }[];
}

const ANI = users[0]!.id;
const BUDI = users[1]!.id;

const MELATI = 12n;
const KENANGA = 13n;

// The products, by what a reader calls them — so a fixture reads as a recipe, not a row of ids.
const id = (name: string) => {
  const found = products.find((p) => p.name === name);
  if (!found) throw new Error(`bundleFixtures: no product named ${name}`);
  return found.id;
};

/** Melati's own. */
export const BERAS = id("Beras Pandan Wangi 5kg");
/** Kenanga's — borrowed by Melati. */
export const GULA = id("Gula Pasir 1kg");
/** Anggrek's (team 15) — all borrowed by Melati. */
export const MINYAK = id("Minyak Goreng Sawit 2L — Satuan");
export const TEPUNG = id("Tepung Terigu Serbaguna 1kg — Satuan");
export const SAUS = id("Saus Sambal Botol 340ml — Satuan");
export const SUSU = id("Susu Kental Manis Kaleng 370g — Satuan");
export const KOPI = id("Kopi Robusta Bubuk 200g — Satuan");
export const TEH = id("Teh Hijau Celup 25s — Satuan");

export const bundleFixtures: BundleFixture[] = [
  {
    id: 81n,
    teamId: MELATI,
    name: "Paket Hemat",
    description: "Beras dan gula untuk listing paket hemat di Shopee",
    createdByUserId: ANI,
    createdAtUnix: daysAgo(20),
    updatedAtUnix: daysAgo(1),
    lines: [
      { productId: BERAS, quantity: 1 },
      { productId: GULA, quantity: 2 },
    ],
  },
  {
    id: 82n,
    teamId: MELATI,
    name: "Paket Hemat",
    description: "Versi Tokopedia — dua karung beras",
    createdByUserId: BUDI,
    createdAtUnix: daysAgo(15),
    updatedAtUnix: daysAgo(3),
    lines: [
      { productId: BERAS, quantity: 2 },
      { productId: MINYAK, quantity: 1 },
    ],
  },
  {
    id: 83n,
    teamId: MELATI,
    name: "Paket Dapur",
    description: "",
    createdByUserId: BUDI,
    createdAtUnix: daysAgo(30),
    updatedAtUnix: daysAgo(6),
    lines: [
      { productId: MINYAK, quantity: 1 },
      { productId: TEPUNG, quantity: 1 },
      { productId: SAUS, quantity: 2 },
    ],
  },
  {
    id: 84n,
    teamId: MELATI,
    name: "Paket Sarapan",
    description: "Kopi, teh dan susu untuk hampers pagi",
    createdByUserId: ANI,
    createdAtUnix: daysAgo(40),
    updatedAtUnix: daysAgo(10),
    lines: [
      { productId: KOPI, quantity: 1 },
      { productId: TEH, quantity: 1 },
      { productId: SUSU, quantity: 1 },
    ],
  },
  {
    id: 85n,
    teamId: MELATI,
    name: "Kopi Robusta 3-pack",
    description: "",
    createdByUserId: ANI,
    createdAtUnix: daysAgo(50),
    updatedAtUnix: daysAgo(12),
    lines: [{ productId: KOPI, quantity: 3 }],
  },
  // Another team's — never on Melati's list, never reachable by Melati's id lookup.
  {
    id: 86n,
    teamId: KENANGA,
    name: "Paket Kenanga",
    description: "",
    createdByUserId: BUDI,
    createdAtUnix: daysAgo(5),
    updatedAtUnix: daysAgo(5),
    lines: [{ productId: GULA, quantity: 1 }],
  },
];

/** A fixture by name — and by its creator, where two share a name (bundle-names-may-repeat). */
export function bundleFixture(name: string, createdByUserId?: bigint): BundleFixture {
  const found = bundleFixtures.find(
    (b) => b.name === name && (createdByUserId === undefined || b.createdByUserId === createdByUserId),
  );
  if (!found) throw new Error(`bundleFixtures: no bundle named ${name}`);
  return found;
}
