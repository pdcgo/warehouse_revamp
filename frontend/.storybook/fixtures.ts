// The canned warehouse that every story reads from.
//
// One fixture set, exported as plain data, so a story can BOTH render a component against it and
// assert on the same values — `expect(canvas.getByText(teams[0].name))` rather than a string typed
// twice that can drift from what the stub actually served.
//
// Ids are deliberately small and distinct per entity kind (teams 1x, shops 2x, suppliers 3x …) so a
// failure that shows an id makes it obvious which fixture leaked into the wrong picker.

import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";

// ── Teams ───────────────────────────────────────────────────────────────────────────────────────
export const teams = [
  { id: 11n, type: TeamType.WAREHOUSE, name: "Gudang Pusat", teamCode: "WH-01", description: "", deleted: false, imageUrl: "" },
  { id: 12n, type: TeamType.SELLING, name: "Toko Melati", teamCode: "SL-01", description: "", deleted: false, imageUrl: "" },
  { id: 13n, type: TeamType.SELLING, name: "Toko Kenanga", teamCode: "SL-02", description: "", deleted: false, imageUrl: "" },
];

// ── Shops ───────────────────────────────────────────────────────────────────────────────────────
export const shops = [
  { id: 21n, teamId: 12n, name: "Melati Official", shopCode: "MEL-SHP", marketplace: Marketplace.SHOPEE, description: "", deleted: false },
  { id: 22n, teamId: 12n, name: "Melati Store", shopCode: "MEL-TOK", marketplace: Marketplace.TOKOPEDIA, description: "", deleted: false },
  { id: 23n, teamId: 12n, name: "Melati Grosir", shopCode: "MEL-LAZ", marketplace: Marketplace.LAZADA, description: "", deleted: false },
];

// ── Suppliers ───────────────────────────────────────────────────────────────────────────────────
export const suppliers = [
  { id: 31n, teamId: 11n, code: "SUP-A", name: "PT Sumber Makmur", contact: "0812-1111", province: "Jawa Barat", city: "Bandung", address: "", description: "", deleted: false },
  { id: 32n, teamId: 11n, code: "SUP-B", name: "CV Cahaya Abadi", contact: "0812-2222", province: "Jawa Timur", city: "Surabaya", address: "", description: "", deleted: false },
];

// ── Racks ───────────────────────────────────────────────────────────────────────────────────────
export const racks = [
  { id: 41n, warehouseId: 11n, code: "A-01-1", name: "Aisle A bawah", description: "", deleted: false },
  { id: 42n, warehouseId: 11n, code: "A-01-2", name: "Aisle A tengah", description: "", deleted: false },
  { id: 43n, warehouseId: 11n, code: "B-02-1", name: "Aisle B bawah", description: "", deleted: false },
];

// ── Categories (a two-level tree — CategorySelect drills into children) ──────────────────────────
export const categories = [
  { id: 51n, name: "Elektronik", parentId: 0n },
  { id: 52n, name: "Audio", parentId: 51n },
  { id: 53n, name: "Headphone", parentId: 52n },
  { id: 54n, name: "Rumah Tangga", parentId: 0n },
  { id: 55n, name: "Dapur", parentId: 54n },
];

// ── Users ───────────────────────────────────────────────────────────────────────────────────────
export const users = [
  { id: 61n, username: "ani", name: "Ani Rahayu", email: "ani@example.test", phoneNumber: "", isSuspended: false, avatarUrl: "" },
  { id: 62n, username: "budi", name: "Budi Santoso", email: "budi@example.test", phoneNumber: "", isSuspended: false, avatarUrl: "" },
  { id: 63n, username: "citra", name: "Citra Dewi", email: "citra@example.test", phoneNumber: "", isSuspended: true, avatarUrl: "" },
];

// PublicUser is the narrower shape SearchUser returns — no email, no suspension.
export const publicUsers = users.map((u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatarUrl: u.avatarUrl,
}));

// ── Products ────────────────────────────────────────────────────────────────────────────────────
export const products = [
  {
    id: 71n, teamId: 11n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g",
    description: "", categoryId: 51n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: false, crossMarkupBps: 0, crossLocked: false, reservedStock: 2,
  },
  {
    id: 72n, teamId: 11n, sku: "SKU-TEH-100", name: "Teh Melati 100g",
    description: "", categoryId: 51n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: false, crossMarkupBps: 0, crossLocked: false, reservedStock: 0,
  },
  {
    id: 73n, teamId: 13n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: false, crossMarkupBps: 150, crossLocked: false, reservedStock: 0,
  },
];

// ── Courier catalogue ───────────────────────────────────────────────────────────────────────────
// ⚠ Codes are LOWERCASE, matching ShippingBadge's colour map (`jne`, `jnt`, `sicepat`, …). A badge
// looks up its palette by code, so an uppercase fixture would quietly fall through to the unknown-
// courier gray and the colour stories would be testing the wrong branch.
export const couriers = [
  { id: 81n, code: "jne", name: "JNE Reguler", active: true },
  { id: 82n, code: "sicepat", name: "SiCepat REG", active: true },
  { id: 83n, code: "anteraja", name: "AnterAja", active: true },
  { id: 84n, code: "pos", name: "POS Indonesia", active: false },
];

// ── The region TREE, for AddressPicker's four cascading level selects ────────────────────────────
//
// Codes follow the real Kepmendagri shape — a child's code is prefixed by its parent's — because
// the picker cascades on `parentCode`, and a flat set of unrelated codes would let a broken cascade
// still look correct.
export const regionTree = [
  { code: "32", parentCode: "", level: 1, name: "Jawa Barat", kodePos: "" },
  { code: "33", parentCode: "", level: 1, name: "Jawa Tengah", kodePos: "" },

  { code: "3273", parentCode: "32", level: 2, name: "Kota Bandung", kodePos: "" },
  { code: "3204", parentCode: "32", level: 2, name: "Kabupaten Bandung", kodePos: "" },

  { code: "327301", parentCode: "3273", level: 3, name: "Sukajadi", kodePos: "" },
  { code: "327302", parentCode: "3273", level: 3, name: "Cicendo", kodePos: "" },

  { code: "3273011001", parentCode: "327301", level: 4, name: "Sukawarna", kodePos: "40162" },
  { code: "3273011002", parentCode: "327301", level: 4, name: "Sukagalih", kodePos: "40163" },
  { code: "3273021002", parentCode: "327302", level: 4, name: "Pajajaran", kodePos: "40173" },
];

// ── Regions, keyed by the postcode the picker searches on ───────────────────────────────────────
export const regions = [
  {
    provinsiCode: "32", provinsiName: "Jawa Barat",
    kabupatenCode: "3273", kabupatenName: "Kota Bandung",
    kecamatanCode: "327301", kecamatanName: "Sukajadi",
    desaCode: "3273011001", desaName: "Sukawarna",
    kodePos: "40162",
  },
  {
    provinsiCode: "32", provinsiName: "Jawa Barat",
    kabupatenCode: "3273", kabupatenName: "Kota Bandung",
    kecamatanCode: "327302", kecamatanName: "Cicendo",
    desaCode: "3273021002", desaName: "Pajajaran",
    kodePos: "40173",
  },
];
