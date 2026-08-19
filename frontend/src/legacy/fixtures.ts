// Sample data for the legacy REFERENCE pages.
//
// The legacy screens are ported as a design reference, not as a working app — their original data
// layer targets a different backend contract that does not exist in this repo (see
// plans/design-system-adoption.md). So each page takes its rows as PROPS and its story supplies
// them from here.
//
// Two consequences worth being deliberate about:
//
//  1. THE PAGES STAY PRESENTATIONAL. Nothing under `legacy/pages/` fetches. That is what lets the
//     screens be reviewed at all without a backend behind them — and it means promoting one later is
//     a matter of adding a `features/<domain>/queries.ts` hook above it, not unpicking one.
//  2. THE FIXTURES ARE SHARED, not per-story. Several screens show the same supplier or product, and
//     three different spellings of "Kaos Polos Hitam" across three reference screens would make them
//     look like three different systems.
//
// ⚠ These are INVENTED. They are not a copy of anyone's data, and no name, code or figure here
// refers to a real supplier, shop or person.

import { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";

export interface SupplierRow {
  id: bigint;
  name: string;
  code: string;
  province: string;
  city: string;
  marketplaceCount: number;
  productCount: number;
  createdAt: bigint;
}

export const SUPPLIERS: SupplierRow[] = [
  { id: 12n, name: "CV Sinar Jaya", code: "SJ-004", province: "Jawa Barat", city: "Bandung", marketplaceCount: 3, productCount: 84, createdAt: 1_772_000_000n },
  { id: 18n, name: "Toko Kain Makmur", code: "TKM-011", province: "Jawa Tengah", city: "Solo", marketplaceCount: 1, productCount: 26, createdAt: 1_774_500_000n },
  { id: 23n, name: "PT Benang Emas", code: "BE-002", province: "Jawa Timur", city: "Surabaya", marketplaceCount: 4, productCount: 152, createdAt: 1_768_900_000n },
  { id: 31n, name: "UD Sumber Rejeki", code: "SR-019", province: "Jawa Barat", city: "Bekasi", marketplaceCount: 2, productCount: 41, createdAt: 1_781_200_000n },
  { id: 44n, name: "Grosir Nusantara", code: "GN-007", province: "Banten", city: "Tangerang", marketplaceCount: 2, productCount: 67, createdAt: 1_783_000_000n },
];

export interface SupplierMarketplaceRow {
  id: bigint;
  marketplace: Marketplace;
  shopName: string;
  url: string;
}

export const SUPPLIER_MARKETPLACES: SupplierMarketplaceRow[] = [
  { id: 1n, marketplace: Marketplace.SHOPEE, shopName: "sinarjaya.official", url: "https://example.invalid/sinarjaya" },
  { id: 2n, marketplace: Marketplace.TOKOPEDIA, shopName: "Sinar Jaya Tekstil", url: "https://example.invalid/sinarjaya-tp" },
  { id: 3n, marketplace: Marketplace.TIKTOK, shopName: "sinarjaya.id", url: "https://example.invalid/sinarjaya-tt" },
];

export const PROVINCES = ["Jawa Barat", "Jawa Tengah", "Jawa Timur", "Banten", "DKI Jakarta"];

export const CITIES: Record<string, string[]> = {
  "Jawa Barat": ["Bandung", "Bekasi", "Bogor"],
  "Jawa Tengah": ["Solo", "Semarang"],
  "Jawa Timur": ["Surabaya", "Malang"],
  Banten: ["Tangerang", "Serang"],
  "DKI Jakarta": ["Jakarta Pusat", "Jakarta Barat"],
};

// ── ORDERS ──────────────────────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "draft"
  | "created"
  | "packing"
  | "shipped"
  | "delivered"
  | "returned"
  | "cancelled"
  | "lost";

export interface OrderRow {
  id: bigint;
  code: string;
  shopName: string;
  marketplace: Marketplace;
  customer: string;
  status: OrderStatus;
  itemCount: number;
  total: bigint;
  courier: string;
  receipt: string;
  createdAt: bigint;
  tags: string[];
}

export const ORDERS: OrderRow[] = [
  { id: 4471n, code: "ORD-4471", shopName: "Toko Jaya Abadi", marketplace: Marketplace.SHOPEE, customer: "Budi Santoso", status: "packing", itemCount: 3, total: 412_000n, courier: "JNE", receipt: "JX9920481221", createdAt: 1_784_900_000n, tags: ["priority"] },
  { id: 4472n, code: "ORD-4472", shopName: "Toko Jaya Abadi", marketplace: Marketplace.TOKOPEDIA, customer: "Siti Aminah", status: "shipped", itemCount: 1, total: 129_000n, courier: "SiCepat", receipt: "SC5512900031", createdAt: 1_784_820_000n, tags: [] },
  { id: 4473n, code: "ORD-4473", shopName: "Gudang Selatan", marketplace: Marketplace.TIKTOK, customer: "Rina Wijaya", status: "created", itemCount: 5, total: 1_840_000n, courier: "J&T", receipt: "", createdAt: 1_784_700_000n, tags: ["cod"] },
  { id: 4474n, code: "ORD-4474", shopName: "Toko Jaya Abadi", marketplace: Marketplace.SHOPEE, customer: "Andi Pratama", status: "returned", itemCount: 2, total: 258_000n, courier: "JNE", receipt: "JX9920481355", createdAt: 1_784_100_000n, tags: [] },
  { id: 4475n, code: "ORD-4475", shopName: "Gudang Selatan", marketplace: Marketplace.LAZADA, customer: "Dewi Lestari", status: "cancelled", itemCount: 1, total: 89_000n, courier: "Ninja", receipt: "", createdAt: 1_783_900_000n, tags: [] },
  { id: 4476n, code: "ORD-4476", shopName: "Toko Jaya Abadi", marketplace: Marketplace.SHOPEE, customer: "Eko Purnomo", status: "delivered", itemCount: 4, total: 675_000n, courier: "SiCepat", receipt: "SC5512900088", createdAt: 1_783_400_000n, tags: [] },
];

export interface OrderLine {
  id: bigint;
  productName: string;
  refId: string;
  variant: string;
  qty: number;
  price: bigint;
}

export const ORDER_LINES: OrderLine[] = [
  { id: 1n, productName: "Kaos Polos Cotton Combed 30s Hitam", refId: "SKU-8842-BLK-L", variant: "L", qty: 2, price: 89_000n },
  { id: 2n, productName: "Hoodie Abu Fleece", refId: "SKU-9001-GRY-XL", variant: "XL", qty: 1, price: 234_000n },
];

export interface OrderTimelineEntry {
  at: bigint;
  label: string;
  actor: string;
  note?: string;
}

export const ORDER_TIMELINE: OrderTimelineEntry[] = [
  { at: 1_784_900_000n, label: "Order imported", actor: "system", note: "From Shopee" },
  { at: 1_784_903_000n, label: "Picking started", actor: "Ani Rahayu" },
  { at: 1_784_906_000n, label: "Packed", actor: "Budi Hartono", note: "2 boxes" },
];

// ── PEOPLE, TEAMS, WAREHOUSES ───────────────────────────────────────────────────────────────────

export interface MemberRow {
  id: bigint;
  name: string;
  username: string;
  roleLabel: string;
  joinedAt: bigint;
  active: boolean;
}

export const MEMBERS: MemberRow[] = [
  { id: 57n, name: "Ani Rahayu", username: "ani.r", roleLabel: "Warehouse Staff", joinedAt: 1_770_000_000n, active: true },
  { id: 91n, name: "Ani Wijaya", username: "ani.w", roleLabel: "Warehouse Admin", joinedAt: 1_766_000_000n, active: true },
  { id: 104n, name: "Budi Hartono", username: "budi.h", roleLabel: "Team Owner", joinedAt: 1_752_000_000n, active: true },
  { id: 118n, name: "Citra Dewi", username: "citra.d", roleLabel: "Customer Service", joinedAt: 1_779_000_000n, active: false },
];

export interface WarehouseRow {
  id: bigint;
  name: string;
  city: string;
  rackCount: number;
  productCount: number;
  active: boolean;
}

export const WAREHOUSES: WarehouseRow[] = [
  { id: 3n, name: "Gudang Utara", city: "Bekasi", rackCount: 84, productCount: 1_240, active: true },
  { id: 7n, name: "Gudang Selatan", city: "Bandung", rackCount: 42, productCount: 610, active: true },
  { id: 11n, name: "Gudang Transit", city: "Tangerang", rackCount: 12, productCount: 88, active: false },
];

export interface NotificationRow {
  id: bigint;
  title: string;
  body: string;
  kind: "stock" | "order" | "billing" | "system";
  at: bigint;
  read: boolean;
}

export const NOTIFICATIONS: NotificationRow[] = [
  { id: 1n, title: "Stock below minimum", body: "Kaos Polos Hitam L is down to 4 units in Gudang Utara.", kind: "stock", at: 1_784_950_000n, read: false },
  { id: 2n, title: "12 orders imported", body: "Shopee import finished with 12 new orders and 3 failures.", kind: "order", at: 1_784_900_000n, read: false },
  { id: 3n, title: "Credit limit at 88%", body: "Unpaid balance is approaching the ceiling for Jaya Abadi.", kind: "billing", at: 1_784_500_000n, read: true },
  { id: 4n, title: "Scheduled maintenance", body: "The system will be read-only on Sunday 02:00–04:00.", kind: "system", at: 1_783_900_000n, read: true },
];

// ── STATISTICS ──────────────────────────────────────────────────────────────────────────────────

// One metric row, whatever the DIMENSION is. The eight statistics screens are the same screen keyed
// to a different subject — product, shop, team, supplier, user — so they share one row shape.
export interface MetricRow {
  id: bigint;
  label: string;
  sublabel?: string;
  orders: number;
  units: number;
  revenue: bigint;
  cost: bigint;
}

export const METRICS: MetricRow[] = [
  { id: 1n, label: "Kaos Polos Hitam L", sublabel: "SKU-8842-BLK-L", orders: 184, units: 402, revenue: 35_780_000n, cost: 22_110_000n },
  { id: 2n, label: "Hoodie Abu XL", sublabel: "SKU-9001-GRY-XL", orders: 96, units: 121, revenue: 28_314_000n, cost: 19_360_000n },
  { id: 3n, label: "Kaos Polos Putih M", sublabel: "SKU-8843-WHT-M", orders: 142, units: 318, revenue: 24_090_000n, cost: 16_740_000n },
  { id: 4n, label: "Topi Baseball", sublabel: "SKU-7710-BLK", orders: 58, units: 74, revenue: 5_920_000n, cost: 3_330_000n },
  { id: 5n, label: "Tote Bag Kanvas", sublabel: "SKU-7412-NAT", orders: 33, units: 41, revenue: 2_870_000n, cost: 1_640_000n },
];

export const METRIC_SPINE = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"];

export const METRIC_SERIES = [
  { name: "Revenue", values: [18_400, 21_200, 19_800, 24_600, 27_100, 23_400, 29_800, 31_200] },
  { name: "Cost", values: [12_100, 13_800, 13_100, 16_200, 17_900, 15_400, 19_100, 20_400] },
];
