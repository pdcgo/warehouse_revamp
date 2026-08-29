// The canned warehouse that every story reads from.
//
// One fixture set, exported as plain data, so a story can BOTH render a component against it and
// assert on the same values — `expect(canvas.getByText(teams[0].name))` rather than a string typed
// twice that can drift from what the stub actually served.
//
// Ids are deliberately small and distinct per entity kind (teams 1x, shops 2x, suppliers 3x …) so a
// failure that shows an id makes it obvious which fixture leaked into the wrong picker.

import { ExpenseKind } from "../src/gen/warehouse/expense/v1/expense_pb";
import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";

// ── Teams ───────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ APPEND, never reorder: several stories index this positionally (`teams[1]!.teamCode`), so a new
// team at the front would silently re-point every one of them at a different row.
export const teams = [
  { id: 11n, type: TeamType.WAREHOUSE, name: "Gudang Pusat", teamCode: "WH-01", description: "", deleted: false, imageUrl: "", priorityProduct: false },
  { id: 12n, type: TeamType.SELLING, name: "Toko Melati", teamCode: "SL-01", description: "", deleted: false, imageUrl: "", priorityProduct: false },
  // THE PRIORITY TEAM. Root has granted team 13 the priority-product feature, so its WHOLE catalogue
  // is priority — which is what makes the picker's three tabs a real partition in a story rather than
  // two populated tabs and an empty one.
  { id: 13n, type: TeamType.SELLING, name: "Toko Kenanga", teamCode: "SL-02", description: "", deleted: false, imageUrl: "", priorityProduct: true },
  // A SECOND warehouse, and it earns its place: the order list is read from both ends, so telling
  // "the orders this team placed" apart from "the orders shipping from this building" needs an order
  // whose two sides point at different buildings. With one warehouse in the fixtures, every order
  // shipped from it and the two readings were indistinguishable.
  { id: 14n, type: TeamType.WAREHOUSE, name: "Gudang Cabang", teamCode: "WH-02", description: "", deleted: false, imageUrl: "", priorityProduct: false },
  // THE BIG CATALOGUE'S OWNER — an ORDINARY selling team, deliberately, so its 44 products land on the
  // picker's "Other Product" tab rather than on My or Priority. Other is the tab carrying the most
  // chrome above the rows (tabs + team filter + search + notices + the tick count), so it is the worst
  // case for the dialog's overflow — which is the case worth being able to look at. See `anggrek` below.
  { id: 15n, type: TeamType.SELLING, name: "Toko Anggrek", teamCode: "SL-03", description: "", deleted: false, imageUrl: "", priorityProduct: false },
];

// ── Shops ───────────────────────────────────────────────────────────────────────────────────────
export const shops = [
  { id: 21n, teamId: 12n, name: "Melati Official", shopCode: "MEL-SHP", marketplace: Marketplace.SHOPEE, description: "", deleted: false },
  { id: 22n, teamId: 12n, name: "Melati Store", shopCode: "MEL-TOK", marketplace: Marketplace.TOKOPEDIA, description: "", deleted: false },
  { id: 23n, teamId: 12n, name: "Melati Grosir", shopCode: "MEL-LAZ", marketplace: Marketplace.LAZADA, description: "", deleted: false },
  // Kenanga's storefront, so the OTHER selling team's orders can name a shop that exists rather than
  // a dangling id. Appended for the same reason as the team above.
  { id: 24n, teamId: 13n, name: "Kenanga Official", shopCode: "KEN-TOK", marketplace: Marketplace.TOKOPEDIA, description: "", deleted: false },
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

// ── A CATALOGUE BIG ENOUGH TO OVERFLOW A DIALOG ─────────────────────────────────────────────────
//
// 44 products for team 15, which exist for ONE reason: four products can never show what a picker
// does when the warehouse actually has a catalogue. With these, the picker's "Other Product" tab
// holds 45 rows — so page 1 is FULL (ten rows, the picker's page size) and the LAST page is SHORT
// (five), which is the pair of states the dialog's height behaviour has to be judged against.
//
// They are ordinary in every way that matters to a story: no stock and no cost (both maps below are
// keyed by id, and an absent id is a real answer), so nothing that reads a warehouse changes shape.
//
// Two are deliberately awkward rather than filler:
//   - a name far longer than the product column, for the `lineClamp` on ProductListItem;
//   - a name SHORTER than its SKU, so the two lines are not always the same width down the page.
const ANGGREK_NAMES = [
  "Minyak Goreng Sawit 2L",
  "Tepung Terigu Serbaguna 1kg",
  "Gula Merah Cetak 500g",
  "Garam Beryodium Halus 250g",
  "Kecap Manis Botol 600ml",
  "Saus Sambal Botol 340ml",
  "Susu Kental Manis Kaleng 370g",
  "Kopi Robusta Bubuk 200g",
  "Teh Hijau Celup 25s",
  "Mie Instan Goreng Karton",
  "Biskuit Kelapa Kaleng 700g",
  "Sabun Mandi Batang 4 pcs",
  "Deterjen Bubuk 800g",
  "Pewangi Pakaian Refill 900ml",
  "Sikat Gigi Dewasa Sedang",
  "Pasta Gigi Mint 190g",
  "Tisu Wajah Kotak 250 lembar",
  "Popok Bayi Perekat M 40s",
  "Air Mineral Galon 19L",
  "Beras Premium Pulen Karung 10kg",
  "Kacang Tanah Kupas 500g",
  "Santan Kelapa Instan 200ml",
];

const anggrek = ANGGREK_NAMES.flatMap((name, i) =>
  // Two pack sizes per name — the way a real catalogue grows, and it keeps 22 readable names from
  // having to become 44 invented ones.
  (["Satuan", "Karton"] as const).map((pack, j) => ({
    id: BigInt(700 + i * 2 + j),
    teamId: 15n,
    sku: `SKU-ANG-${String(i * 2 + j + 1).padStart(3, "0")}`,
    name: `${name} — ${pack}`,
    description: "",
    categoryId: 54n,
    defaultImageUrl: "",
    defaultImageThumbnailUrl: "",
    deleted: false,
    crossMarkupBps: 0,
    crossLocked: false,
    reservedStock: 0,
  })),
);

// The two awkward rows, patched in rather than appended, so they sit in the MIDDLE of a page instead
// of at the end of the list where nothing renders beside them.
anggrek[4]!.name =
  "Paket Sembako Lengkap Isi 12 Item — Beras, Minyak, Gula, Tepung, Kecap, Sarden, Kopi dan Teh";
anggrek[9]!.name = "Lada Bubuk";

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
  // ⚠ APPENDED, like the teams above — several stories index this list positionally.
  //
  // It belongs to team 12, which is an ORDINARY other team (13 is the priority one). That is what
  // makes the picker's three tabs provable as a PARTITION: without a non-priority other-team product,
  // "Other" and "Priority" would be indistinguishable from "everyone else" and "everyone else".
  {
    id: 74n, teamId: 12n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: false, crossMarkupBps: 0, crossLocked: false, reservedStock: 0,
  },
  // ⚠ LAST, and that is load-bearing rather than tidiness. The stub filters this array in order, so
  // the four named products above keep the first rows of every page-1 they appear on — a story that
  // ticks product 74 on the "Other" tab would otherwise have to page to find it.
  ...anggrek,
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

// ── What the warehouse holds, and what it cost ──────────────────────────────────────────────────
//
// Keyed by product id, and BOTH maps describe ONE building — the warehouse team (11). Stock and HPP
// are facts about a warehouse, not about a product, so a second warehouse gets its own map rather
// than another column here; that is the same reason the order form re-reads both when the warehouse
// changes.
//
// Product 73 belongs to ANOTHER team (13) and is on this warehouse's shelf anyway. That is not an
// inconsistency — it is cross-team selling, and having it in the fixtures is what keeps the "whose
// goods are these" column honest in a story.
export const warehouseStock: Record<string, bigint> = {
  "71": 40n,
  // DELIBERATELY SMALL. The order form's short-stock state is unreachable without a line the
  // warehouse cannot fill, so one fixture product is kept scarce on purpose.
  "72": 3n,
  "73": 12n,
};

// HPP, in whole rupiah.
//
// ⚠ 0 means UNKNOWN — the warehouse has no restock history for that product — never "free". Product
// 73 carries a 0 deliberately, so a story can pin that the form renders it as unknown rather than
// booking goods at no cost.
export const productCosts: Record<string, bigint> = {
  "71": 18500n,
  "72": 9000n,
  "73": 0n,
};

// ── Time ────────────────────────────────────────────────────────────────────────────────────────
//
// An order carries a REAL timestamp, resolved against the clock the story runs on, because the list
// filters on a date WINDOW and a relative range ("last 30 days") is live by design — it stores the
// day count, not resolved dates. A frozen epoch would slide out of every window as the calendar
// moved, and the filter stories would start failing on the date rather than on a change.
const DAY = 86_400;

export const daysAgo = (days: number): bigint => BigInt(Math.floor(Date.now() / 1000) - days * DAY);

// ── Orders ──────────────────────────────────────────────────────────────────────────────────────
//
// AN ORDER HAS TWO SIDES, and the order list is read from both (#151):
//
//   `teamId`      the SELLING team that placed it — what its own list shows
//   `warehouseId` the WAREHOUSE it ships from — what that building's crew picks from
//
// The set below is built so those two readings genuinely differ, because that difference IS the
// difference between the two versions of the screen:
//
//   Toko Melati (12)   placed 101–109. All ship from Gudang Pusat (11) except 107 and 109, which
//                      ship from Gudang Cabang (14) — Melati sees those two, Gudang Pusat does not.
//   Toko Kenanga (13)  placed 110–111, both shipping from Gudang Pusat — so Gudang Pusat sees two
//                      orders belonging to a team whose own list Melati can never see.
//
// Two rows carry a job of their own:
//
//   108 is 120 DAYS OLD, and every quick range in the date picker tops out at 90 — so it is the row
//       that proves a date window narrowed anything at all.
//   107 is the only CANCELLED one, and it ships from the OTHER warehouse, which leaves Gudang Pusat
//       with an empty Cancelled tab — the one state that says "no orders in THIS status" rather than
//       "no orders". The 30-day money excludes it either way: a cancelled order is not a sale.
export const orders = [
  { id: 101n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.PLACED, customerName: "Bu Ani", customerPhone: "0812-3456-0001", subtotal: 235_000n, shippingCost: 15_000n, total: 250_000n, shippingCode: "jne", createdAtUnix: daysAgo(1) },
  { id: 102n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.PLACED, customerName: "Pak Budi", customerPhone: "0812-3456-0002", subtotal: 168_000n, shippingCost: 12_000n, total: 180_000n, shippingCode: "sicepat", createdAtUnix: daysAgo(2) },
  { id: 103n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.CONFIRMED, customerName: "Ibu Citra", customerPhone: "0812-3456-0003", subtotal: 86_000n, shippingCost: 9_000n, total: 95_000n, shippingCode: "jne", createdAtUnix: daysAgo(3) },
  { id: 104n, teamId: 12n, warehouseId: 11n, shopId: 23n, status: OrderStatus.PICKING, customerName: "Pak Dedi", customerPhone: "0812-3456-0004", subtotal: 402_000n, shippingCost: 18_000n, total: 420_000n, shippingCode: "anteraja", createdAtUnix: daysAgo(4) },
  { id: 105n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.PACKED, customerName: "Bu Eka", customerPhone: "0812-3456-0005", subtotal: 296_000n, shippingCost: 14_000n, total: 310_000n, shippingCode: "jne", createdAtUnix: daysAgo(5) },
  { id: 106n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.SHIPPED, customerName: "Pak Firman", customerPhone: "0812-3456-0006", subtotal: 129_000n, shippingCost: 11_000n, total: 140_000n, shippingCode: "sicepat", createdAtUnix: daysAgo(6) },
  { id: 107n, teamId: 12n, warehouseId: 14n, shopId: 21n, status: OrderStatus.CANCELLED, customerName: "Bu Gita", customerPhone: "0812-3456-0007", subtotal: 66_000n, shippingCost: 9_000n, total: 75_000n, shippingCode: "jne", createdAtUnix: daysAgo(8) },
  { id: 108n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.SHIPPED, customerName: "Pak Hasan", customerPhone: "0812-3456-0008", subtotal: 480_000n, shippingCost: 20_000n, total: 500_000n, shippingCode: "anteraja", createdAtUnix: daysAgo(120) },
  { id: 109n, teamId: 12n, warehouseId: 14n, shopId: 23n, status: OrderStatus.CONFIRMED, customerName: "Bu Indah", customerPhone: "0812-3456-0009", subtotal: 252_000n, shippingCost: 13_000n, total: 265_000n, shippingCode: "jne", createdAtUnix: daysAgo(1) },

  { id: 110n, teamId: 13n, warehouseId: 11n, shopId: 24n, status: OrderStatus.PLACED, customerName: "Pak Joko", customerPhone: "0813-9999-0001", subtotal: 618_000n, shippingCost: 22_000n, total: 640_000n, shippingCode: "anteraja", createdAtUnix: daysAgo(2) },
  { id: 111n, teamId: 13n, warehouseId: 11n, shopId: 24n, status: OrderStatus.PACKED, customerName: "Bu Kartika", customerPhone: "0813-9999-0002", subtotal: 198_000n, shippingCost: 12_000n, total: 210_000n, shippingCode: "jne", createdAtUnix: daysAgo(3) },
];

// ── What a DETAIL read adds, and a list row never carries ───────────────────────────────────────
//
// `OrderList` returns a summary; `OrderDetail` is the only read that populates `items` and `events`
// (order.proto). So the detail page is not "the list row on its own screen" — it is a different
// message, and the difference is exactly the two tables the page's two tabs are built from.
//
// Held per order id rather than folded into `orders`, for two reasons:
//
//   - a list fixture carrying line items would let a list story assert on data the list RPC does not
//     actually return, and that story would keep passing against a server that never sent it
//   - only a handful of orders are ever OPENED, so writing lines for all eleven is work that buys
//     nothing. `orderDetailFor` fills the rest from the row itself.
//
// 101 is the one written out in full — three lines, a real address, a note, an attached receipt and
// a marketplace total that DIFFERS from ours. Every one of those is a branch on the Info tab that a
// bare order would leave untested.
export const orderDetailExtras: Record<
  string,
  {
    marketplaceTotal?: bigint;
    cogs?: bigint;
    note?: string;
    orderExternalRefId?: string;
    items?: { id: bigint; productId: bigint; sku: string; name: string; quantity: number; unitPrice: bigint; unitCost: bigint }[];
    events?: { id: bigint; kind: number; actorUserId: bigint; atUnix: bigint }[];
    address?: Record<string, string>;
    receipt?: { documentId: string; filename: string; mimeType: string };
  }
> = {
  // ⚠ 245.000 ON A 250.000 ORDER. `marketplace_total` is what the BUYER PAID THE PLATFORM and
  // `total` is what WE quoted — they are two different facts and they routinely disagree. Liability
  // opens its account from the marketplace figure, never from ours, so a fixture where the two were
  // equal would hide the one number that matters and make every liability screen look right by
  // accident.
  "101": {
    marketplaceTotal: 245_000n,
    cogs: 148_000n,
    note: "Titip bubble wrap tambahan, barang pecah belah.",
    orderExternalRefId: "MEL-250101-0001",
    items: [
      { id: 1n, productId: 301n, sku: "KPH-M", name: "Kaos Polos Hitam — M", quantity: 2, unitPrice: 75_000n, unitCost: 48_000n },
      { id: 2n, productId: 302n, sku: "KPP-L", name: "Kaos Polos Putih — L", quantity: 1, unitPrice: 75_000n, unitCost: 46_000n },
      { id: 3n, productId: 303n, sku: "TOP-01", name: "Topi Rajut", quantity: 1, unitPrice: 10_000n, unitCost: 6_000n },
    ],
    events: [
      { id: 1n, kind: 1, actorUserId: 61n, atUnix: daysAgo(1) },
      { id: 2n, kind: 2, actorUserId: 62n, atUnix: daysAgo(1) + 3_600n },
    ],
    address: {
      provinsiCode: "32", provinsiName: "Jawa Barat",
      kabupatenCode: "3273", kabupatenName: "Kota Bandung",
      kecamatanCode: "327301", kecamatanName: "Coblong",
      desaCode: "3273011", desaName: "Dago",
      kodePos: "40135",
      addressLine: "Jl. Ir. H. Juanda No. 12, RT 03 / RW 05",
    },
    receipt: { documentId: "doc-101", filename: "resi-101.pdf", mimeType: "application/pdf" },
  },

  // A CANCELLED order, and the only fixture whose timeline ENDS badly. The Timeline tab colours the
  // two endings and nothing in between, so one of each is the minimum that proves it.
  "107": {
    marketplaceTotal: 73_000n,
    cogs: 41_000n,
    events: [
      { id: 1n, kind: 1, actorUserId: 61n, atUnix: daysAgo(8) },
      { id: 2n, kind: 3, actorUserId: 63n, atUnix: daysAgo(7) },
    ],
  },

  // NO ACTOR AT ALL — every event backfilled by the history migration is in this state, and 0 is
  // "not recorded", not "user zero". The page must show the step and stay silent about who took it,
  // rather than inventing a name or hiding the step.
  "108": {
    marketplaceTotal: 0n,
    cogs: 310_000n,
    events: [
      { id: 1n, kind: 1, actorUserId: 0n, atUnix: daysAgo(120) },
      { id: 2n, kind: 6, actorUserId: 0n, atUnix: daysAgo(119) },
    ],
  },
};

/**
 * One order as `OrderDetail` returns it — the list row, plus whatever `orderDetailExtras` adds.
 *
 * An order with no extras still gets ONE line and ONE event, derived from the row. An empty items
 * table on a detail page reads as "this order has nothing in it", which is a state no real order is
 * ever in — so the default is a plausible order, not an empty one.
 */
export function orderDetailFor(id: bigint) {
  const row = orders.find((o) => o.id === id);
  if (!row) return undefined;

  const extra = orderDetailExtras[id.toString()] ?? {};

  return {
    ...row,
    marketplaceTotal: extra.marketplaceTotal ?? row.total,
    cogs: extra.cogs ?? (row.subtotal * 6n) / 10n,
    note: extra.note ?? "",
    orderExternalRefId: extra.orderExternalRefId ?? "",
    address: extra.address,
    receipt: extra.receipt,
    items: extra.items ?? [
      {
        id: 1n,
        productId: 301n,
        sku: "KPH-M",
        name: "Kaos Polos Hitam — M",
        quantity: 1,
        unitPrice: row.subtotal,
        unitCost: (row.subtotal * 6n) / 10n,
      },
    ],
    events: extra.events ?? [{ id: 1n, kind: 1, actorUserId: 61n, atUnix: row.createdAtUnix }],
  };
}

// ── Order drafts ────────────────────────────────────────────────────────────────────────────────
//
// Only the SELLING team has any, and that is not an omission: a draft is a half-typed order, and a
// warehouse never types one. It is what the Drafts tab's badge counts, so the two versions of the
// list differ there too — a number for Melati, a zero for Gudang Pusat.
export const orderDrafts = [
  { id: 201n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9001", shopId: 21n, warehouseId: 11n, customerName: "Bu Lestari", customerPhone: "0812-3456-0101", shippingCode: "jne", shippingCost: 15_000n, itemCount: 3, unmappedItemCount: 1, touchedFields: [], createdAtUnix: daysAgo(1), updatedAtUnix: daysAgo(1) },
  { id: 202n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9002", shopId: 22n, warehouseId: 11n, customerName: "Pak Mamat", customerPhone: "0812-3456-0102", shippingCode: "sicepat", shippingCost: 12_000n, itemCount: 2, unmappedItemCount: 0, touchedFields: [], createdAtUnix: daysAgo(2), updatedAtUnix: daysAgo(2) },
];

// ── The daily statement's money ─────────────────────────────────────────────────────────────────
//
// Three sparse day-series, one per service the statement subtracts:
//
//   revenueDays      what a SELLING team's orders were expected to make   (revenue_service)
//   liabilityDays   what a WAREHOUSE charged the teams it serves         (liability_service)
//   expenseDays      what either of them spent                           (expense_service)
//
// SPARSE ON PURPOSE, and dated RELATIVE to the clock the story runs on — both because that is what
// the RPCs actually return. The screen owns the date spine (lib/period.ts), so the fixtures exist to
// prove it fills the gaps: five days of activity inside a rolling 30-day window means 25 quiet rows,
// and "the 14th was quiet" versus "the 14th did not load" is the distinction the spine is for.
//
// Each series carries `ago` rather than a date, and the stub resolves it — a fixture holding a frozen
// `2026-08-14` would slide out of the default window the moment the calendar moved past it, and the
// statement stories would then fail on the date rather than on a change to the screen.

/** `days` ago as the LOCAL `yyyy-mm-dd` the Daily RPCs bucket on — the same day the picker resolves. */
export const dayKey = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Toko Melati's orders, four days of them inside the last fortnight.
//
// Day 2 is the one carrying an UNKNOWN COST (#74): its margin is counted as if those goods were free,
// which is the case the screen has to warn about rather than quietly include.
export const revenueDays = [
  { teamId: 12n, ago: 1, orders: 4n, revenue: 1_200_000n, cogs: 700_000n, shippingCost: 60_000n, expectedMargin: 440_000n, unknownCostOrders: 0n },
  { teamId: 12n, ago: 2, orders: 3n, revenue: 900_000n, cogs: 520_000n, shippingCost: 45_000n, expectedMargin: 335_000n, unknownCostOrders: 1n },
  { teamId: 12n, ago: 5, orders: 2n, revenue: 500_000n, cogs: 300_000n, shippingCost: 30_000n, expectedMargin: 170_000n, unknownCostOrders: 0n },
  // OUTSIDE "last 7 days", inside "last 30" — this row and the payroll on day 12 are what a narrowed
  // window is proved by.
  { teamId: 12n, ago: 9, orders: 1n, revenue: 250_000n, cogs: 150_000n, shippingCost: 15_000n, expectedMargin: 85_000n, unknownCostOrders: 0n },

  // ⚠ OUTSIDE THE 30-DAY WINDOW ENTIRELY, and that is their whole job: they are invisible to the daily
  // view and land in two OTHER months, so a monthly rollup that quietly covered only the recent weeks
  // would show the same money as the daily one and look correct. Kept well under a year ago so they are
  // inside the 12-month window whatever day of the year the story runs on.
  { teamId: 12n, ago: 45, orders: 5n, revenue: 1_500_000n, cogs: 900_000n, shippingCost: 70_000n, expectedMargin: 530_000n, unknownCostOrders: 0n },
  { teamId: 12n, ago: 200, orders: 2n, revenue: 600_000n, cogs: 350_000n, shippingCost: 35_000n, expectedMargin: 215_000n, unknownCostOrders: 0n },
];

// Gudang Pusat's ledger, by source.
//
// ⚠ COD DWARFS THE HANDLING FEES, deliberately: a warehouse handles far more of the courier's cash
// than it earns, so a screen that counted COD as income would report roughly three times the profit
// it made. The statement excludes it and says why — this fixture is what makes that assertable.
export const liabilityDays = [
  { teamId: 11n, ago: 1, handlingFee: 500_000n, codFee: 1_200_000n },
  { teamId: 11n, ago: 3, handlingFee: 400_000n, codFee: 800_000n },
  { teamId: 11n, ago: 8, handlingFee: 200_000n, codFee: 0n },
];

// What each team spent, one record per kind per day — so the stub derives both the day's total and
// its entry count from this map alone, and narrowing by kind is exactly dropping the other keys.
//
// The SELLING team has no stock loss and the WAREHOUSE does, which is not a detail of the fixture but
// of the system: inventory posts every write-off against the warehouse's own team (#211). It is what
// makes the summary's "of which … stock written off" line appear on one statement and not the other.
export const expenseDays: { teamId: bigint; ago: number; byKind: Record<number, bigint> }[] = [
  { teamId: 12n, ago: 2, byKind: { [ExpenseKind.ADS]: 250_000n } },
  { teamId: 12n, ago: 5, byKind: { [ExpenseKind.ADS]: 180_000n, [ExpenseKind.OPERATIONAL]: 320_000n } },
  // NOTHING WAS SOLD THAT DAY, and payroll went out anyway — the row that proves a day can be a loss
  // with no income series on it at all.
  { teamId: 12n, ago: 12, byKind: { [ExpenseKind.PAYROLL]: 200_000n } },
  // The spending half of the two out-of-window months above — a rollup has to carry both sides of the
  // subtraction back, not just the income.
  { teamId: 12n, ago: 45, byKind: { [ExpenseKind.OPERATIONAL]: 400_000n } },
  { teamId: 12n, ago: 200, byKind: { [ExpenseKind.ADS]: 120_000n } },

  { teamId: 11n, ago: 1, byKind: { [ExpenseKind.STOCK_LOSS]: 90_000n } },
  { teamId: 11n, ago: 3, byKind: { [ExpenseKind.OPERATIONAL]: 500_000n, [ExpenseKind.STOCK_LOSS]: 40_000n } },
  { teamId: 11n, ago: 8, byKind: { [ExpenseKind.PAYROLL]: 100_000n } },
];

// ── CREDIT TERMS (#189) ─────────────────────────────────────────────────────────────────────────
//
// Team 11 (Gudang Pusat) is the CREDITOR throughout — a warehouse, which is who carries the credit
// risk in this system.
//
// The fixture exists to make all THREE limit states visible at once, because they are the states the
// screen is built to keep apart and a demo with only "a number" proves nothing:
//
//   counterparty 0  → the DEFAULT row — unlimited, and it is the rule the others are exceptions to
//   team 12         → capped, and 87% used   → the 80% WARNING fires
//   team 13         → 0                      → FROZEN, which is the opposite of the default's absent
//   team 14         → capped, and 124% used  → OVER
//   team 15         → no row at all          → it appears in the "set terms" options, not the table
export const liabilityTerms = [
  { teamId: 11n, counterpartyId: 0n, handlingFee: 25_000n, productMarkupBp: 500n, creditLimit: undefined, reason: "" },
  { teamId: 11n, counterpartyId: 12n, handlingFee: 30_000n, productMarkupBp: 750n, creditLimit: 10_000_000n, reason: "" },
  { teamId: 11n, counterpartyId: 13n, handlingFee: 25_000n, productMarkupBp: 500n, creditLimit: 0n, reason: "" },
  { teamId: 11n, counterpartyId: 14n, handlingFee: 0n, productMarkupBp: 0n, creditLimit: 5_000_000n, reason: "" },
];

// What each debtor owes team 11 right now. Positive = they owe us, so these are what the limits cap.
export const liabilityPositions = [
  { counterpartyId: 12n, balance: 8_700_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
  { counterpartyId: 13n, balance: 1_000_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
  { counterpartyId: 14n, balance: 6_200_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
  { counterpartyId: 15n, balance: 250_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
];

// The change log. ⚠ Read the LIMIT columns of change 3 and 4 together — they are the two acts a
// single integer column cannot tell apart:
//
//   change 3  5.000.000 → undefined   the limit was REMOVED   (unlimited)
//   change 4  undefined → 0           the team was FROZEN     (no credit at all)
//
// Change 1 is the raise that ERASES A WARNING: team 14 sat at 6.2m against 5m — over its limit — and
// a raise to 20m would drop it to 31% with nothing on the current row showing it had ever been over.
// The log is the only place that survives.
export const liabilityTermsChanges = [
  {
    id: 4n, counterpartyId: 13n, actorId: 1n,
    oldCreditLimit: undefined, newCreditLimit: 0n,
    oldHandlingFee: 25_000n, newHandlingFee: 25_000n,
    oldProductMarkupBp: 500n, newProductMarkupBp: 500n,
    reason: "Repeated unpaid restock outlays — frozen pending payment.",
    override: false, changedAtUnix: 1_756_000_000n,
  },
  {
    id: 3n, counterpartyId: 12n, actorId: 2n,
    oldCreditLimit: 5_000_000n, newCreditLimit: undefined,
    oldHandlingFee: 30_000n, newHandlingFee: 30_000n,
    oldProductMarkupBp: 750n, newProductMarkupBp: 750n,
    reason: "Cap lifted for the ramadan push — agreed with the owner.",
    override: true, changedAtUnix: 1_755_600_000n,
  },
  {
    id: 2n, counterpartyId: 12n, actorId: 1n,
    oldCreditLimit: undefined, newCreditLimit: 10_000_000n,
    oldHandlingFee: 25_000n, newHandlingFee: 30_000n,
    oldProductMarkupBp: 500n, newProductMarkupBp: 750n,
    reason: "",
    override: false, changedAtUnix: 1_755_200_000n,
  },
  {
    id: 1n, counterpartyId: 14n, actorId: 1n,
    oldCreditLimit: 20_000_000n, newCreditLimit: 5_000_000n,
    oldHandlingFee: 0n, newHandlingFee: 0n,
    oldProductMarkupBp: 0n, newProductMarkupBp: 0n,
    reason: "",
    override: false, changedAtUnix: 1_754_800_000n,
  },
];
