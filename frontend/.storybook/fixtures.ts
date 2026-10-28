// The canned warehouse that every story reads from.
//
// One fixture set, exported as plain data, so a story can BOTH render a component against it and
// assert on the same values — `expect(canvas.getByText(teams[0].name))` rather than a string typed
// twice that can drift from what the stub actually served.
//
// Ids are deliberately small and distinct per entity kind (teams 1x, shops 2x, suppliers 3x …) so a
// failure that shows an id makes it obvious which fixture leaked into the wrong picker.

import { type Timestamp, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ExpenseKind } from "../src/gen/warehouse/expense/v1/expense_pb";
import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { SettlementType } from "../src/gen/warehouse/settlement/v1/settlement_pb";
import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
  UploadedFileStatus,
} from "../src/gen/warehouse/settlement_importer/v1/settlement_importer_pb";
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
  // Melati's TikTok storefront — the settlement importer reads Shopee and TikTok statements, and this is
  // the only way a story reaches the TikTok import. Appended, so every index above still holds.
  { id: 25n, teamId: 12n, name: "Melati TikTok", shopCode: "MEL-TIK", marketplace: Marketplace.TIKTOK, description: "", deleted: false },
];

// ── Suppliers ───────────────────────────────────────────────────────────────────────────────────
// In supplierFixtures.ts, beside the writeable stub that serves them (supplierStub.ts).

// ── Racks ───────────────────────────────────────────────────────────────────────────────────────
export const racks = [
  { id: 41n, warehouseId: 11n, code: "A-01-1", name: "Aisle A bawah", description: "", deleted: false },
  { id: 42n, warehouseId: 11n, code: "A-01-2", name: "Aisle A tengah", description: "", deleted: false },
  { id: 43n, warehouseId: 11n, code: "B-02-1", name: "Aisle B bawah", description: "", deleted: false },
  // Gudang Cabang's shelves — APPENDED for the warehouse transfer, whose receiving warehouse (B) puts the good units
  // away on its OWN racks. RackList is scoped by the warehouse, so these never show at Gudang Pusat.
  { id: 44n, warehouseId: 14n, code: "C-01-1", name: "Cabang rak depan", description: "", deleted: false },
  { id: 45n, warehouseId: 14n, code: "C-01-2", name: "Cabang rak belakang", description: "", deleted: false },
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
  // The member list's cast (userStub.ts gives each a role per team). APPEND, never reorder — stories
  // index this positionally. Dewi owns both teams, Fajar is a second Root, Gita the System Administrator.
  { id: 64n, username: "dewi", name: "Dewi Lestari", email: "dewi@example.test", phoneNumber: "081234567890", isSuspended: false, avatarUrl: "" },
  { id: 65n, username: "eko", name: "Eko Prasetyo", email: "eko@example.test", phoneNumber: "+62 812-9876-1234", isSuspended: false, avatarUrl: "" },
  { id: 66n, username: "fajar", name: "Fajar Nugroho", email: "fajar@example.test", phoneNumber: "", isSuspended: false, avatarUrl: "" },
  { id: 67n, username: "gita", name: "Gita Ramadhani", email: "gita@example.test", phoneNumber: "", isSuspended: false, avatarUrl: "" },
  // A SECOND Ani, in no team — two people one name apart, told apart only by the phone ending
  // (a-result-shows-the-phones-last-four-digits).
  { id: 68n, username: "anil", name: "Ani Lestari", email: "anil@example.test", phoneNumber: "081377778888", isSuspended: false, avatarUrl: "" },
];

// PublicUser is the narrower shape a name lookup and the search return — no email, and of the phone only its last
// four digits (a-result-shows-the-phones-last-four-digits). Suspension is on it: a "who" filter badges it.
export const publicUsers = users.map((u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatarUrl: u.avatarUrl,
  phoneLast4: u.phoneNumber.replace(/\D/g, "").slice(-4),
  isSuspended: u.isSuspended,
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

// A flat drawing standing in for a product photo — so a screen's picture path is exercised by at least one product
// (Beras), while the others keep the placeholder. Inline, so no story waits on a network image.
const RICE_PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#fef3c7"/>` +
    `<rect x="14" y="10" width="36" height="46" rx="6" fill="#f5f5f4" stroke="#a8a29e" stroke-width="2"/>` +
    `<rect x="14" y="24" width="36" height="14" fill="#16a34a"/>` +
    `</svg>`,
)}`;

export const products = [
  // A 10% CROSS MARKUP (the-cross-markup-belongs-to-the-product) — so a team selling Gudang Pusat's Kopi is invoiced
  // over its HPP, and the order form's invoice can be pinned to the PRODUCT's rate. Teh beside it carries none, which
  // makes a draft holding both (202) one owner at two rates.
  {
    id: 71n, teamId: 11n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g",
    description: "", categoryId: 51n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: false, crossMarkupBps: 1000, crossLocked: false, reservedStock: 2,
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
    description: "", categoryId: 54n, defaultImageUrl: RICE_PICTURE, defaultImageThumbnailUrl: RICE_PICTURE,
    deleted: false, crossMarkupBps: 0, crossLocked: false, reservedStock: 0,
  },
  // ⚠ LAST, and that is load-bearing rather than tidiness. The stub filters this array in order, so
  // the four named products above keep the first rows of every page-1 they appear on — a story that
  // ticks product 74 on the "Other" tab would otherwise have to page to find it.
  ...anggrek,
];

// ── Courier catalogue — shipment_service (docs/business/shipment) ────────────────────────────────
//
// The three the owner named, plus one DELETED channel, because every rule worth testing is about the
// difference: the picker hides it, the management list hides it until asked, and a by-id lookup still
// names it (a-deleted-channel-still-resolves-by-id).
//
// ⚠ Codes are LOWERCASE, matching ShippingBadge's colour map. A badge looks up its palette by code, so an
// uppercase fixture would quietly fall through to the unknown-courier gray.
//
// Some order fixtures below use `anteraja`, which is NOT here on purpose: it is the old-data case the
// code bridge renders as the raw code (the-old-catalogue-bridges-by-code).
export const shipmentChannels = [
  { id: 91n, code: "jne", name: "JNE", desc: "Pickup daily at 15:00", isDeleted: false },
  { id: 92n, code: "jnt", name: "J&T", desc: "", isDeleted: false },
  { id: 93n, code: "sicepat", name: "SiCepat", desc: "Drop-off at the Cikarang hub", isDeleted: false },
  { id: 94n, code: "pos", name: "POS Indonesia", desc: "No longer picks up here", isDeleted: true },
];

// ── What the stubbed ReceiptCheck reads off a label ──────────────────────────────────────────────
//
// ⚠ INVENTED, in the real shapes (an SPX tracking number, a Shopee order number). Never a real
// sample's values: those name a buyer and where their parcel went, and this repo is public.
export const receiptLabel = {
  receipt: "SPXID000000000001",
  orderRefId: "260101AAAA0001",
  customerName: "Budi Contoh",
  phone: "",
  address: "Jl. Contoh No. 1, Kebayoran Baru, Jakarta Selatan",
};

/**
 * A fake label PDF for a story. `result` names the answer the stub gives (`not_shipping_label`,
 * `multiple_labels`, `unknown_label`, `unreadable`, or `busy` — refused, two checks already running); without it,
 * the file reads as `receiptLabel`.
 */
export function receiptLabelFile(result?: string): File {
  const body = `%PDF-1.4\n${result ? `stub-result:${result}\n` : ""}%%EOF\n`;

  return new File([body], "label.pdf", { type: "application/pdf" });
}

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
  // Toko Melati's own Beras — APPENDED so the team the warehouse transfer form runs as has something of its own on
  // Gudang Pusat's shelves to send. Without it OwnStockedProductPicker opens empty for team 12.
  "74": 25n,
};

// HPP — the AVERAGE value of what the shelf holds, in whole rupiah: what StockCost and the owner's stock
// value read. No order reads it (an-order-is-costed-at-what-leaves-the-shelf) — an order line is costed
// from `productBatches` below, as the take would draw them.
//
// ⚠ 0 means UNKNOWN — the warehouse has no restock history for that product — never "free". Product
// 73 carries a 0 deliberately, so a story can pin that the form renders it as unknown rather than
// booking goods at no cost.
export const productCosts: Record<string, bigint> = {
  "71": 18500n,
  "72": 9000n,
  "73": 0n,
};

// THE BATCHES ON THE SHELF, oldest first — what a take draws, and therefore what an order line costs
// (an-order-is-costed-at-what-leaves-the-shelf). Each product's agree with the two maps above: the units sum to
// `warehouseStock`, and their value over the units is `productCosts`.
//
// ⚠ TEH (72) ARRIVED TWICE, at two prices — 1 at 8.000, then 2 at 9.500 (an average of 9.000) — so one line can
// span two batches: 1 Teh costs 8.000, 2 cost 1 × 8.000 + 1 × 9.500 = 17.500 (never the average's 18.000), and all 3
// cost the 27.000 the shelf is worth.
export const productBatches: Record<string, { quantity: bigint; unitCost: number }[]> = {
  "71": [{ quantity: 40n, unitCost: 18_500 }],
  "72": [
    { quantity: 1n, unitCost: 8_000 },
    { quantity: 2n, unitCost: 9_500 },
  ],
  "73": [{ quantity: 12n, unitCost: 0 }],
  "74": [{ quantity: 25n, unitCost: 0 }],
};

/**
 * What a take of `quantity` would draw of one product from the fixture warehouse — StockTakeQuote's answer, shared by
 * the stub and the stories that hand a component its costs directly, so the two cannot disagree. Not enough on the
 * shelf draws NOTHING: no cost, no batches.
 */
export function drawFrom(productId: string, quantity: bigint) {
  const batches = productBatches[productId] ?? [];
  const available = batches.reduce((sum, b) => sum + b.quantity, 0n);

  if (quantity < 1n || available < quantity) {
    return { quantity, available, total: undefined, unitCost: undefined, batches: [] };
  }

  let left = quantity;
  const drawn: { quantity: bigint; unitCost: number }[] = [];

  for (const b of batches) {
    if (left === 0n) break;

    const n = b.quantity < left ? b.quantity : left;
    drawn.push({ quantity: n, unitCost: b.unitCost });
    left -= n;
  }

  const total = drawn.reduce((sum, b) => sum + Number(b.quantity) * b.unitCost, 0);

  return { quantity, available, total, unitCost: total / Number(quantity), batches: drawn };
}

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
// Two more rows carry a job in the MONEY columns:
//
//   107 has NO marketplace figure and NO recorded cost — a phone order, cancelled, that nobody ever
//       costed. It is the row where the margin cell must refuse (`—`) rather than print a confident
//       100%, and where the "MP" line under the total must be absent rather than `Rp 0`.
//   108 has a marketplace REFERENCE but no marketplace TOTAL. Those are two different absences and
//       this is the row that proves it: the order plainly came from a storefront, and nobody wrote
//       down what the storefront took. 0 is "not recorded", never "sold for nothing" (order.proto).
//
// ⚠ `platformTotal` DISAGREES WITH `totalCost` on every row that has both, on purpose: `totalCost` is what the order
// cost US (goods + the warehouse's fee) and the platform figure is what the buyer paid the platform after its own
// vouchers and subsidies. A fixture where they matched would make every settlement screen look right by accident.
//
// Only 101 and 110 carry a BUYER USERNAME — one on each detail page (the seller's and the warehouse's). Every other
// row has none, which is the ordinary case (the-buyers-username-is-optional) and must show nothing at all.
const orderRows = [
  { id: 101n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.PENDING, customerName: "Bu Ani", customerPhone: "0812-3456-0001", buyerUsername: "ani.melati88", platformTotal: 245_000n, goodsCost: 148_000n, orderExternalRefId: "SP-2409-8841", shippingCode: "jne", createdByUserId: 65n, createdAtUnix: daysAgo(1) },
  { id: 102n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.PENDING, customerName: "Pak Budi", customerPhone: "0812-3456-0002", platformTotal: 176_500n, goodsCost: 107_520n, orderExternalRefId: "TK-88120347", shippingCode: "sicepat", createdByUserId: 62n, createdAtUnix: daysAgo(2) },
  { id: 103n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.PROCESSED, customerName: "Ibu Citra", customerPhone: "0812-3456-0003", platformTotal: 92_000n, goodsCost: 55_040n, orderExternalRefId: "SP-2409-8852", shippingCode: "jne", createdByUserId: 65n, createdAtUnix: daysAgo(3) },
  { id: 104n, teamId: 12n, warehouseId: 11n, shopId: 23n, status: OrderStatus.PROCESSED, customerName: "Pak Dedi", customerPhone: "0812-3456-0004", platformTotal: 413_000n, goodsCost: 257_280n, orderExternalRefId: "LZ-4471902", shippingCode: "anteraja", createdByUserId: 63n, createdAtUnix: daysAgo(4) },
  { id: 105n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.PICKED, customerName: "Bu Eka", customerPhone: "0812-3456-0005", platformTotal: 303_500n, goodsCost: 189_440n, orderExternalRefId: "TK-88120388", shippingCode: "jne", createdByUserId: 65n, createdAtUnix: daysAgo(5) },
  { id: 106n, teamId: 12n, warehouseId: 11n, shopId: 21n, status: OrderStatus.SHIPPING, customerName: "Pak Firman", customerPhone: "0812-3456-0006", platformTotal: 137_000n, goodsCost: 82_560n, orderExternalRefId: "SP-2409-8877", shippingCode: "sicepat", createdByUserId: 62n, createdAtUnix: daysAgo(6) },
  { id: 107n, teamId: 12n, warehouseId: 14n, shopId: 21n, status: OrderStatus.CANCEL, customerName: "Bu Gita", customerPhone: "0812-3456-0007", shippingCode: "jne", createdByUserId: 0n, createdAtUnix: daysAgo(8) },
  { id: 108n, teamId: 12n, warehouseId: 11n, shopId: 22n, status: OrderStatus.SHIPPING, customerName: "Pak Hasan", customerPhone: "0812-3456-0008", goodsCost: 307_200n, orderExternalRefId: "TK-88120411", shippingCode: "anteraja", createdByUserId: 62n, createdAtUnix: daysAgo(120) },
  { id: 109n, teamId: 12n, warehouseId: 14n, shopId: 23n, status: OrderStatus.PROCESSED, customerName: "Bu Indah", customerPhone: "0812-3456-0009", platformTotal: 258_000n, goodsCost: 161_280n, orderExternalRefId: "LZ-4471955", shippingCode: "jne", createdByUserId: 65n, createdAtUnix: daysAgo(1) },

  { id: 110n, teamId: 13n, warehouseId: 11n, shopId: 24n, status: OrderStatus.PENDING, customerName: "Pak Joko", customerPhone: "0813-9999-0001", buyerUsername: "joko_kenanga", platformTotal: 628_000n, goodsCost: 395_520n, orderExternalRefId: "SP-2410-1002", shippingCode: "anteraja", createdByUserId: 61n, createdAtUnix: daysAgo(2) },
  { id: 111n, teamId: 13n, warehouseId: 11n, shopId: 24n, status: OrderStatus.PICKED, customerName: "Bu Kartika", customerPhone: "0813-9999-0002", shippingCode: "jne", createdByUserId: 61n, createdAtUnix: daysAgo(3) },
];

// ── The three facts a row has carried since 00018/00019 ─────────────────────────────────────────
//
// The tracking number (`receipt_code`), the frozen warehouse fee (`warehouse_fee`) and when the order entered
// its status (`status_at_unix`). DERIVED FROM THE ID, never random, so a story asserts on the same value every
// run — and they are the values the screens' old mocks invented, so no figure a story already pins moved when
// the mocks went: a flat 2.000–4.000 fee, and the same offsets per status.
//
// ⚠ INVENTED, in real shapes (an SPX/J&T-like tracking number): copy one into a courier's site and it will not
// be found, which is the point of a fixture.
const CARRIERS = ["JP", "SPX", "AJ"];

const STATUS_OFFSET: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.PROCESSED]: 3 * 3600,
  [OrderStatus.PICKED]: 5 * 3600,
  [OrderStatus.SHIPPING]: 20 * 3600,
  [OrderStatus.SHIPPED]: 26 * 3600,
  [OrderStatus.COMPLETED]: 4 * DAY,
  [OrderStatus.PROBLEM]: 3 * DAY,
  [OrderStatus.LOST]: 9 * DAY,
  [OrderStatus.RETURN]: 6 * DAY,
  [OrderStatus.RETURN_COMPLETED]: 7 * DAY,
  [OrderStatus.CANCEL]: 2 * 3600,
};

// The ship-by deadlines, in hours from NOW — anchored on the clock rather than on the order, so the preview holds
// one row in each urgency band (overdue, under 6 h, under 24 h, later). Anchored on `created_at`, every fixture would
// be days overdue at once and the bands could never be looked at.
const DEADLINE_HOURS = [-9, 2, 11, 30, 73];
const NOW = BigInt(Math.floor(Date.now() / 1000));

function rowFacts(row: { id: bigint; status: OrderStatus; createdAtUnix: bigint; orderExternalRefId?: string }) {
  const n = Number(row.id);
  const offset = STATUS_OFFSET[row.status];

  return {
    // When the buyer ordered on the storefront: 8 to 90 minutes before we wrote it down. An order with no
    // marketplace ref carries none — the "not recorded" case, as for an order placed before the field.
    platformCreatedAtUnix: (row.orderExternalRefId ?? "") === "" ? 0n : row.createdAtUnix - BigInt(480 + (n % 14) * 360),
    // The marketplace's ship-by time. Every fixture has one; `orderDeadline` hides it once the parcel has left.
    platformShipmentDeadlineUnix: NOW + BigInt(DEADLINE_HOURS[n % DEADLINE_HOURS.length]! * 3600),
    receiptCode: `${CARRIERS[n % CARRIERS.length]}${(n * 8675309).toString().padStart(10, "0").slice(0, 10)}`,
    warehouseFee: 2000 + (n % 5) * 500,
    // A pending order entered pending the moment it was placed; every other status some hours or days later.
    statusAtUnix: row.createdAtUnix + BigInt(offset === undefined ? 0 : offset + (n % 7) * 1800),
  };
}

// `totalCost` is frozen on the server as goods_cost + warehouse_fee (selling 00027) — derived here the same way, so a
// story reading it reads the sum the list and the detail compute.
export const orders = orderRows.map((row) => {
  const facts = rowFacts(row);

  return { ...row, ...facts, totalCost: Number(row.goodsCost ?? 0n) + facts.warehouseFee };
});

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
// 101 is the one written out in full — three lines, a real address, notes from BOTH sides, an attached
// receipt and a marketplace total that DIFFERS from ours. Every one of those is a branch on the Info tab
// that a bare order would leave untested. 102 carries a hand-back to pending WITH ITS REASON, beside a note:
// the one status row whose `note` stays on the Timeline while a note row goes to Catatan.
export const orderDetailExtras: Record<
  string,
  {
    platformTotal?: bigint;
    goodsCost?: bigint;
    orderExternalRefId?: string;
    items?: {
      id: bigint;
      productId: bigint;
      sku: string;
      name: string;
      quantity: number;
      unitCost: bigint;
      /** A borrowed line's frozen figures — absent on an own line here, as on a line frozen before 00023/00025. */
      unitCostWithMarkup?: number;
      markupTotal?: number;
      total?: number;
    }[];
    /**
     * The timeline (order-timeline-logs-replaces-order-events): status 0 = a NOTE row (a-note-is-a-timeline-row), any
     * other = a status row whose `note` is its reason; from 1 = warehouse, 2 = selling. There is no `Order.note`.
     */
    timelineLogs?: { id: bigint; status: number; note?: string; from: number; actorId: bigint; createdAtUnix: bigint }[];
    address?: Record<string, string>;
    receipt?: { documentId: string; filename: string; mimeType: string };
  }
> = {
  // ⚠ 245.000 ON AN ORDER THAT COST US 150.500. `platform_total` is what the BUYER PAID THE PLATFORM and
  // `total_cost` is what the order cost US — they are two different facts and they routinely disagree. Liability
  // opens its account from the marketplace figure, never from ours, so a fixture where the two were
  // equal would hide the one number that matters and make every liability screen look right by
  // accident.
  // ⚠ IT NO LONGER RESTATES THE MONEY. `platform_total` and `goods_cost` are on the ROW, and repeating
  // them here — nor the marketplace reference — is how the same order came to read 150.400 on the
  // list and 148.000 on its own detail, under two different marketplace ids.
  // The list reads `order.goodsCost` while the detail SUMS THE LINES, and `order.proto` says those are the
  // same number ("the lines it was computed from are frozen too").
  "101": {
    items: [
      { id: 1n, productId: 301n, sku: "KPH-M", name: "Kaos Polos Hitam — M", quantity: 2, unitCost: 48_000n },
      { id: 2n, productId: 302n, sku: "KPP-L", name: "Kaos Polos Putih — L", quantity: 1, unitCost: 46_000n },
      { id: 3n, productId: 303n, sku: "TOP-01", name: "Topi Rajut", quantity: 1, unitCost: 6_000n },
    ],
    // TWO NOTES, ONE PER SIDE (a-note-is-a-timeline-row). The seller's is the one typed on the create form — the
    // order's first note row, written with the order — and the warehouse's came later, so it is listed FIRST.
    timelineLogs: [
      { id: 1n, status: 1, from: 2, actorId: 61n, createdAtUnix: daysAgo(1) },
      { id: 2n, status: 0, note: "Titip bubble wrap tambahan, barang pecah belah.", from: 2, actorId: 61n, createdAtUnix: daysAgo(1) },
      { id: 3n, status: 2, from: 1, actorId: 62n, createdAtUnix: daysAgo(1) + 3_600n },
      { id: 4n, status: 0, note: "Topi Rajut tinggal 1 di Rak A, sudah kami sisihkan untuk pesanan ini.", from: 1, actorId: 62n, createdAtUnix: daysAgo(1) + 5_400n },
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

  // HANDED BACK TO PENDING, WITH THE REASON — a STATUS row carrying a `note`, which is not a note row: it explains its
  // step and stays on the Timeline. The warehouse's note before it (status 0) is a note row, and goes to Catatan. Eko
  // (65) works the building; the order ends PENDING, as its row says.
  "102": {
    timelineLogs: [
      { id: 1n, status: 1, from: 2, actorId: 62n, createdAtUnix: daysAgo(2) },
      { id: 2n, status: 2, from: 1, actorId: 65n, createdAtUnix: daysAgo(2) + 3_600n },
      { id: 3n, status: 0, note: "Rak A kosong, kami cek gudang belakang dulu.", from: 1, actorId: 65n, createdAtUnix: daysAgo(2) + 7_200n },
      { id: 4n, status: 1, note: "Stok Topi Rajut habis di Rak A — menunggu restock.", from: 1, actorId: 65n, createdAtUnix: daysAgo(2) + 10_800n },
    ],
  },

  // A BORROWED LINE — another team's product, frozen WITH its owner's markup (the-cross-charge-lives-on-the-line). The
  // goods cost the seller 189.440 (the row's `goodsCost`, Σ the line totals), of which 31.573 is the owner's markup on
  // a drawn cost of 157.867. One unit, as the row's units say, so the census is unchanged. The detail's harga beli is
  // the price WITH the markup, so the line adds up to the goods_cost and total sistem is it plus the fee.
  "105": {
    items: [
      {
        id: 1n,
        productId: 401n,
        sku: "SEP-KNS-42",
        name: "Sepatu Kanvas — 42",
        quantity: 1,
        unitCost: 157_867n,
        unitCostWithMarkup: 189_440,
        markupTotal: 31_573,
        total: 189_440,
      },
    ],
  },

  // A LINE ON A CATALOGUE PRODUCT THAT HAS A PICTURE — Melati's own Beras (74), the one fixture product drawn with
  // one. Every other order's lines name products the catalogue fixtures do not hold, so ProductByIds answers nothing
  // for them and they keep the placeholder; this is the order whose line shows its product's picture. One unit at the
  // row's own `goodsCost`, exactly as the default line would be, so the list and the detail still agree about it.
  "106": {
    items: [
      { id: 1n, productId: 74n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg", quantity: 1, unitCost: 82_560n },
    ],
  },

  // A CANCELLED order, and the only fixture whose timeline ENDS badly. The Timeline tab colours the
  // two endings and nothing in between, so one of each is the minimum that proves it.
  // ⚠ IT ADDS ONLY EVENTS. It used to carry a marketplace total and a cost, which its own LIST row
  // says it does not have — the same order reading as costed on one screen and uncosted on the next.
  // The row is the source of truth for the money; extras add what a list row cannot carry.
  "107": {
    timelineLogs: [
      { id: 1n, status: 1, from: 2, actorId: 61n, createdAtUnix: daysAgo(8) },
      { id: 2n, status: 3, from: 2, actorId: 63n, createdAtUnix: daysAgo(7) },
    ],
  },

  // NO ACTOR AT ALL — 0 is "not recorded", not "user zero". The page must show the step and stay silent
  // about who took it, rather than inventing a name or hiding the step.
  "108": {
    platformTotal: 0n,
    goodsCost: 310_000n,
    timelineLogs: [
      { id: 1n, status: 1, from: 2, actorId: 0n, createdAtUnix: daysAgo(120) },
      { id: 2n, status: 6, from: 1, actorId: 0n, createdAtUnix: daysAgo(119) },
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
    // ⚠ THE ROW WINS OVER A DERIVED GUESS. These three used to fall back to the order's old `total`, to 60% of
    // its old subtotal and to `""` — so the detail page contradicted the list about the same order:
    // a different marketplace figure, a different cost, and a reference that vanished on opening it.
    // The extras add what a list row cannot carry (lines, the timeline and its notes, address, receipt); the money
    // and the reference belong to the row.
    platformTotal: extra.platformTotal ?? row.platformTotal ?? 0n,
    goodsCost: extra.goodsCost ?? row.goodsCost ?? 0n,
    orderExternalRefId: extra.orderExternalRefId ?? row.orderExternalRefId ?? "",
    address: extra.address,
    receipt: extra.receipt,
    items: extra.items ?? [
      {
        id: 1n,
        productId: 301n,
        sku: "KPH-M",
        name: "Kaos Polos Hitam — M",
        quantity: 1,
        // ⚠ THE ROW'S OWN `goods_cost`, not an invented 60%. The detail page SUMS its lines while the list
        // reads `order.goodsCost`, and `order.proto` says those are one number — so a made-up line cost made
        // the same order read Rp 310.700 on the list and Rp 291.500 on its detail, and gave a cancelled
        // order the list calls unpriced a cost on its detail. `0` stays unknown, as on the row.
        unitCost: row.goodsCost ?? 0n,
      },
    ],
    timelineLogs: extra.timelineLogs ?? [{ id: 1n, status: 1, from: 2, actorId: 61n, createdAtUnix: row.createdAtUnix }],
  };
}

// ── Order drafts ────────────────────────────────────────────────────────────────────────────────
//
// Only the SELLING team has any, and that is not an omission: a draft is a half-typed order, and a
// warehouse never types one. It is what the Drafts tab's badge counts, so the two versions of the
// list differ there too — a number for Melati, a zero for Gudang Pusat.
export const orderDrafts = [
  { id: 201n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9001", shopId: 21n, warehouseId: 11n, customerName: "Bu Lestari", customerPhone: "0812-3456-0101", buyerUsername: "lestari.shop", shippingCode: "jne", itemCount: 3, unmappedItemCount: 1, touchedFields: [], createdAtUnix: daysAgo(2), updatedAtUnix: daysAgo(1), platformCreatedAtUnix: 0n, platformShipmentDeadlineUnix: 0n, platformTotal: 0n },
  { id: 202n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9002", shopId: 22n, warehouseId: 11n, customerName: "Pak Mamat", customerPhone: "0812-3456-0102", buyerUsername: "", shippingCode: "sicepat", itemCount: 2, unmappedItemCount: 0, touchedFields: [], createdAtUnix: daysAgo(1), updatedAtUnix: daysAgo(1), platformCreatedAtUnix: daysAgo(1) - 3_600n, platformShipmentDeadlineUnix: 0n, platformTotal: 130_000n },
  // TWO DRAFTS ONE FIELD SHORT OF READY — every line mapped, and each missing exactly one of the two things Promote
  // refuses that the list can read: 203 the marketplace order date, 204 the stored sell price. Without them the list
  // could call a draft ready that Promote turns away, and no story would notice.
  { id: 203n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9003", shopId: 21n, warehouseId: 11n, customerName: "Bu Rina", customerPhone: "0812-3456-0103", buyerUsername: "", shippingCode: "jne", itemCount: 1, unmappedItemCount: 0, touchedFields: [], createdAtUnix: daysAgo(1), updatedAtUnix: daysAgo(1), platformCreatedAtUnix: 0n, platformShipmentDeadlineUnix: 0n, platformTotal: 55_000n },
  { id: 204n, teamId: 12n, authorUserId: 61n, source: "manual", externalId: "MEL-9004", shopId: 22n, warehouseId: 11n, customerName: "Pak Yusuf", customerPhone: "0812-3456-0104", buyerUsername: "", shippingCode: "sicepat", itemCount: 1, unmappedItemCount: 0, touchedFields: [], createdAtUnix: daysAgo(1), updatedAtUnix: daysAgo(1), platformCreatedAtUnix: daysAgo(1) - 7_200n, platformShipmentDeadlineUnix: 0n, platformTotal: 0n },
];

// ── What a draft DETAIL read adds — its lines ───────────────────────────────────────────────────
//
// Same split as `orderDetailExtras`: `OrderDraftList` returns a summary with only the COUNTS, and
// `OrderDraftDetail` is the one read that populates `items`. The line counts here must agree with
// `itemCount` / `unmappedItemCount` above, or the list and the detail disagree about the same draft.
//
//   201  three lines, ONE UNMAPPED (productId 0) — Promote is disabled and says why.
//   202  two lines, all mapped, all within the warehouse's stock, its marketplace order date set and its sell price
//        STORED (130.000, the rows' own sum) — the draft that is READY.
//        201 has no order date and no stored sell price, the other things Promote names
//        (platform-created-at-is-required-at-finalize, platform-total-is-required-at-finalize) — its field follows the
//        rows' 155.000, which is not stored until it is saved.
//   203  204  list rows only — no lines here, so their detail opens empty. The list reads only their counts.
//
// Mapped lines point at products 71 and 72, which Gudang Pusat holds (`warehouseStock`), so the
// availability column has a real figure to show rather than a dash.
const draftAddress = {
  provinsiCode: "32", provinsiName: "Jawa Barat",
  kabupatenCode: "3273", kabupatenName: "Kota Bandung",
  kecamatanCode: "327301", kecamatanName: "Sukajadi",
  desaCode: "3273011001", desaName: "Sukawarna",
  kodePos: "40162",
  addressLine: "Jl. Sukajadi No. 45",
};

export const orderDraftItems: Record<
  string,
  { id: bigint; externalSku: string; externalName: string; productId: bigint; quantity: number; unitPrice: bigint }[]
> = {
  "201": [
    { id: 2011n, externalSku: "SHP-KOPI-250", externalName: "Kopi Arabika Gayo 250gr Biji Sangrai", productId: 71n, quantity: 2, unitPrice: 55_000n },
    { id: 2012n, externalSku: "SHP-TEH-100", externalName: "Teh Melati Wangi 100 gram", productId: 72n, quantity: 1, unitPrice: 25_000n },
    // THE UNMAPPED ONE — the scrape read it, nobody has said which product it is yet.
    { id: 2013n, externalSku: "SHP-MUG-01", externalName: "Mug Keramik Motif Batik (bonus)", productId: 0n, quantity: 1, unitPrice: 20_000n },
  ],
  "202": [
    { id: 2021n, externalSku: "TK-KOPI-250", externalName: "Kopi Arabika 250g", productId: 71n, quantity: 1, unitPrice: 55_000n },
    // EXACTLY what the warehouse holds (product 72 has 3) — ready as it stands, and ONE click on the
    // + away from short. That is the edge the short-stock alert is judged against.
    { id: 2022n, externalSku: "TK-TEH-100", externalName: "Teh Melati Kemasan 100gr", productId: 72n, quantity: 3, unitPrice: 25_000n },
  ],
};

/** One draft as `OrderDraftDetail` returns it — the list row plus its lines and a frozen address. */
export function orderDraftDetailFor(id: bigint) {
  const row = orderDrafts.find((d) => d.id === id);
  if (!row) return undefined;

  return { ...row, address: draftAddress, items: orderDraftItems[id.toString()] ?? [] };
}

// ── Where an order's goods were drawn from — `StockPickLocations` ───────────────────────────────
//
// Keyed by order id. 101 is the pick list worth looking at, because its three lines land on the
// three things the shelf column can say:
//
//   301  TWO shelves — two walks, and the screen must show both, never choose one for the picker
//   302  UNPLACED (rack 0) — a real place, said in words rather than left blank
//   303  NO recorded draw at all — an order placed before stock integration (#149)
//
// Every other order ships its one default line (product 301) from a single shelf.
export const pickLocations: Record<string, { productId: bigint; rackId: bigint; rackCode: string; quantity: bigint }[]> = {
  "101": [
    { productId: 301n, rackId: 41n, rackCode: "A-01-1", quantity: 1n },
    { productId: 301n, rackId: 42n, rackCode: "A-01-2", quantity: 1n },
    { productId: 302n, rackId: 0n, rackCode: "", quantity: 1n },
  ],
};

export function pickLocationsFor(orderId: bigint) {
  return pickLocations[orderId.toString()] ?? [{ productId: 301n, rackId: 43n, rackCode: "B-02-1", quantity: 1n }];
}

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
  { teamId: 11n, counterpartyId: 0n, handlingFee: 25_000n, creditLimit: undefined, reason: "" },
  { teamId: 11n, counterpartyId: 12n, handlingFee: 30_000n, creditLimit: 10_000_000n, reason: "" },
  { teamId: 11n, counterpartyId: 13n, handlingFee: 25_000n, creditLimit: 0n, reason: "" },
  { teamId: 11n, counterpartyId: 14n, handlingFee: 0n, creditLimit: 5_000_000n, reason: "" },
];

// What each debtor owes team 11 right now. Positive = they owe us, so these are what the limits cap.
export const liabilityPositions = [
  // 12 has one payment waiting for team 11 to confirm — liabilityPayments' 602.
  { counterpartyId: 12n, balance: 8_700_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 1 },
  { counterpartyId: 13n, balance: 1_000_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
  { counterpartyId: 14n, balance: 6_200_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
  { counterpartyId: 15n, balance: 250_000n, oldestUnsettledAtUnix: 0n, awaitingConfirmation: 0 },
];

// THE LIMITS SET ON A TEAM, from the DEBTOR's side — what LiabilityCreditByIds answers
// (the-debtor-sees-the-limits-set-on-it). Toko Melati (12) is the team ordering in the order-form stories.
//
// ⚠ GUDANG PUSAT (11) IS NOT HERE. Its limit on a team and that team's debt are read off `liabilityTerms` and
// `liabilityPositions` above — the very rows the creditor's own screens show — so the two sides of one pair cannot
// disagree in a story: Melati owes Gudang Pusat 8.700.000 of its 10.000.000, the 87% the creditor sees too.
//
//   13 Toko Kenanga  → capped, 20% used     → OK
//   14 Gudang Cabang → no limit, owed 860k  → UNLIMITED, which must read as words, not as a full bar
//   15 Toko Anggrek  → capped, 87% used     → NEAR — the spec's own example
export const liabilityCredits = [
  { debtorTeamId: 12n, creditorTeamId: 13n, creditLimit: 2_000_000n as bigint | undefined, debt: 400_000n },
  { debtorTeamId: 12n, creditorTeamId: 14n, creditLimit: undefined as bigint | undefined, debt: 860_000n },
  { debtorTeamId: 12n, creditorTeamId: 15n, creditLimit: 1_000_000n as bigint | undefined, debt: 870_000n },
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
    reason: "Repeated unpaid restock outlays — frozen pending payment.",
    override: false, changedAtUnix: 1_756_000_000n,
  },
  {
    id: 3n, counterpartyId: 12n, actorId: 2n,
    oldCreditLimit: 5_000_000n, newCreditLimit: undefined,
    oldHandlingFee: 30_000n, newHandlingFee: 30_000n,
    reason: "Cap lifted for the ramadan push — agreed with the owner.",
    override: true, changedAtUnix: 1_755_600_000n,
  },
  {
    id: 2n, counterpartyId: 12n, actorId: 1n,
    oldCreditLimit: undefined, newCreditLimit: 10_000_000n,
    oldHandlingFee: 25_000n, newHandlingFee: 30_000n,
    reason: "",
    override: false, changedAtUnix: 1_755_200_000n,
  },
  {
    id: 1n, counterpartyId: 14n, actorId: 1n,
    oldCreditLimit: 20_000_000n, newCreditLimit: 5_000_000n,
    oldHandlingFee: 0n, newHandlingFee: 0n,
    reason: "",
    override: false, changedAtUnix: 1_754_800_000n,
  },
];

// The pair ledger for warehouse 11 ↔ selling 12 — what the pair detail page reads.
//
// ⚠ Signed FROM TEAM 11'S SIDE: positive = they owe us. So the handling fees are positive and the
// broken-goods reimbursement is negative, because that is the one cause where the WAREHOUSE is the
// debtor. A fixture with only positive rows would make the payable tab permanently empty and the
// screen's two-column direction rule untestable.
export const liabilityEntries = [
  { id: 501n, teamId: 11n, counterpartyId: 12n, amount: 30_000n, sourceType: 2, sourceId: 9001n, reversal: false, groupId: 1n, balanceAfter: 8_700_000n, createdAtUnix: 1_756_000_000n },
  { id: 502n, teamId: 11n, counterpartyId: 12n, amount: 1_200_000n, sourceType: 5, sourceId: 7001n, reversal: false, groupId: 2n, balanceAfter: 8_670_000n, createdAtUnix: 1_755_900_000n },
  { id: 503n, teamId: 11n, counterpartyId: 12n, amount: -450_000n, sourceType: 6, sourceId: 6001n, reversal: false, groupId: 3n, balanceAfter: 7_470_000n, createdAtUnix: 1_755_800_000n },
  { id: 504n, teamId: 11n, counterpartyId: 12n, amount: 30_000n, sourceType: 2, sourceId: 9000n, reversal: false, groupId: 4n, balanceAfter: 7_920_000n, createdAtUnix: 1_755_700_000n },
];

// One payment from each side, so both the "my payments" and "their payments" tabs have a row — and
// the second is RECORDED rather than confirmed, which is the state only the creditor can clear.
// ⚠ EVERY PAYMENT CARRIES PROOF, because the contract requires at least one document
// (a-payment-must-carry-proof). A fixture with an empty `documentIds` would be a payment the server
// would have refused, and it would let a story pass against a screen that cannot happen.
// And each names the account it LEFT (a-team-payment-posts-on-accept) — 1307 BCA Gudang is team 11's,
// 1301 BCA Operasional team 12's — and, once accepted, the one it LANDED in; 0 until then.
export const liabilityPayments = [
  { id: 601n, payerTeamId: 11n, creditorTeamId: 12n, amount: 500_000n, status: 2, note: "Transfer BCA", recordedBy: 1n, confirmedBy: 2n, createdAtUnix: 1_755_600_000n, confirmedAtUnix: 1_755_610_000n, documentIds: ["doc-601"], reason: "", fromAccountId: 1307n, toAccountId: 1301n },
  { id: 602n, payerTeamId: 12n, creditorTeamId: 11n, amount: 2_000_000n, status: 1, note: "Transfer Mandiri", recordedBy: 2n, confirmedBy: 0n, createdAtUnix: 1_755_500_000n, confirmedAtUnix: 0n, documentIds: ["doc-602a", "doc-602b"], reason: "", fromAccountId: 1301n, toAccountId: 0n },
  // A REFUSED CLAIM — status 4, nothing posted, and the reason the payer has to read.
  { id: 603n, payerTeamId: 12n, creditorTeamId: 11n, amount: 750_000n, status: 4, note: "Transfer BNI", recordedBy: 2n, confirmedBy: 0n, createdAtUnix: 1_755_400_000n, confirmedAtUnix: 0n, documentIds: ["doc-603"], reason: "no transfer of this amount reached our account", fromAccountId: 1301n, toAccountId: 0n },
];

// ── The settlement reports ──────────────────────────────────────────────────────────────────────
//
// ONE consistent book for Toko Melati (12), so every figure on the report can be checked against
// another: the days fold into the summary, and the shops and the people each partition it.
//
//   5 days ago   a sale of 300.000                                      shortfall −300.000
//   3 days ago   250.000 arrives, a 15.000 ads fee is charged           shortfall  −65.000
//   2 days ago   200.000 is withdrawn to the bank                       position  −265.000
//   1 day ago    a 120.000 sale is placed AND cancelled, +5.000 claim   position  −260.000
//
// So over the default 30 days: sold 300.000, received 240.000, a gap of 60.000 — a 20% take rate —
// 200.000 withdrawn, and a position to date of 260.000: the gap PLUS the withdrawal, which counts in it
// (#withdrawal-counts-in-the-position) and is never part of what was received.
export const settlementReportDays: {
  teamId: bigint;
  ago: number;
  initialTotal: bigint;
  initialTotalCancel: bigint;
  fund: bigint;
  externalAdsFee: bigint;
  marketplaceAdjustment: bigint;
  withdrawal: bigint;
}[] = [
  { teamId: 12n, ago: 5, initialTotal: -300_000n, initialTotalCancel: 0n, fund: 0n, externalAdsFee: 0n, marketplaceAdjustment: 0n, withdrawal: 0n },
  { teamId: 12n, ago: 3, initialTotal: 0n, initialTotalCancel: 0n, fund: 250_000n, externalAdsFee: -15_000n, marketplaceAdjustment: 0n, withdrawal: 0n },
  { teamId: 12n, ago: 2, initialTotal: 0n, initialTotalCancel: 0n, fund: 0n, externalAdsFee: 0n, marketplaceAdjustment: 0n, withdrawal: -200_000n },
  { teamId: 12n, ago: 1, initialTotal: -120_000n, initialTotalCancel: 120_000n, fund: 0n, externalAdsFee: 0n, marketplaceAdjustment: 5_000n, withdrawal: 0n },
];

// The same book split by SHOP and by PERSON. Each split sums to the team: 300.000 sold, 240.000
// received, a 60.000 shortfall. Ranked by the shortfall, Melati Official and Ani come first.
export const settlementReportGroups = {
  shop: [
    { id: 21n, sales: 200_000n, received: 150_000n },
    { id: 22n, sales: 100_000n, received: 90_000n },
  ],
  user: [
    { id: 61n, sales: 180_000n, received: 135_000n },
    { id: 62n, sales: 120_000n, received: 105_000n },
  ],
};

// ── Settlement imports ──────────────────────────────────────────────────────────────────────────
//
// Toko Melati's imported statements (docs/business/settlement/settlement_importer_decision.md) — one of
// each state the list has to draw: done twice, interrupted, failed. A file's held, skipped and
// to-the-shop tallies are exactly the rows its page lists below, so a story can check one against the
// other.
const importedAt = (iso: string) => timestampFromDate(new Date(iso));
const sha = (seed: string) => seed.repeat(64 / seed.length);

// Spelled out rather than inferred: inference would type each row's `finishedAt` as what THAT row
// holds, and the stub importer writes a timestamp onto a row that started without one.
type ImportFile = {
  id: bigint;
  teamId: bigint;
  shopId: bigint;
  platform: Marketplace;
  documentId: string;
  contentSha256: string;
  periodFrom: string;
  periodTo: string;
  status: UploadedFileStatus;
  failure: string;
  tally: { total: number; posted: number; existing: number; held: number; skipped: number; postedToShop: number };
  createdByUserId: bigint;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt: Timestamp | undefined;
};

export const settlementImports: ImportFile[] = [
  {
    id: 901n,
    teamId: 12n,
    shopId: 21n,
    platform: Marketplace.SHOPEE,
    documentId: "doc-901",
    contentSha256: sha("9f2c"),
    periodFrom: "2026-09-27",
    periodTo: "2026-09-27",
    status: UploadedFileStatus.DONE,
    failure: "",
    tally: { total: 124, posted: 120, existing: 0, held: 2, skipped: 2, postedToShop: 2 },
    createdByUserId: 62n,
    createdAt: importedAt("2026-09-28T09:10:00+07:00"),
    updatedAt: importedAt("2026-09-28T09:10:40+07:00"),
    finishedAt: importedAt("2026-09-28T09:10:40+07:00"),
  },
  {
    id: 902n,
    teamId: 12n,
    shopId: 25n,
    platform: Marketplace.TIKTOK,
    documentId: "doc-902",
    contentSha256: sha("47ab"),
    periodFrom: "2026-09-26",
    periodTo: "2026-09-27",
    status: UploadedFileStatus.DONE,
    failure: "",
    tally: { total: 86, posted: 70, existing: 12, held: 1, skipped: 3, postedToShop: 1 },
    createdByUserId: 61n,
    createdAt: importedAt("2026-09-28T08:45:00+07:00"),
    updatedAt: importedAt("2026-09-28T08:45:25+07:00"),
    finishedAt: importedAt("2026-09-28T08:45:25+07:00"),
  },
  // The server stopped at row 110 of 240. Uploading the same file again finishes it.
  {
    id: 903n,
    teamId: 12n,
    shopId: 25n,
    platform: Marketplace.TIKTOK,
    documentId: "doc-903",
    contentSha256: sha("c3d1"),
    periodFrom: "2026-09-20",
    periodTo: "2026-09-26",
    status: UploadedFileStatus.INTERRUPTED,
    failure: "",
    tally: { total: 240, posted: 110, existing: 0, held: 0, skipped: 0, postedToShop: 0 },
    createdByUserId: 62n,
    createdAt: importedAt("2026-09-27T17:02:00+07:00"),
    updatedAt: importedAt("2026-09-27T17:03:10+07:00"),
    finishedAt: undefined,
  },
  // A statement from the wrong shop: its orders belong to Melati Store (a-file-with-another-shops-orders-is-refused).
  {
    id: 904n,
    teamId: 12n,
    shopId: 21n,
    platform: Marketplace.SHOPEE,
    documentId: "doc-904",
    contentSha256: sha("0e7f"),
    periodFrom: "2026-09-25",
    periodTo: "2026-09-25",
    status: UploadedFileStatus.FAILED,
    failure: "3 of this file's orders belong to Melati Store — the whole file is refused, nothing was posted",
    tally: { total: 0, posted: 0, existing: 0, held: 0, skipped: 0, postedToShop: 0 },
    createdByUserId: 61n,
    createdAt: importedAt("2026-09-26T10:15:00+07:00"),
    updatedAt: importedAt("2026-09-26T10:15:05+07:00"),
    finishedAt: importedAt("2026-09-26T10:15:05+07:00"),
  },
];

type ImportLine = {
  id: bigint;
  uploadedFileId: bigint;
  sheet: string;
  orderRef: string;
  platformType: string;
  description: string;
  settlementType: SettlementType;
  change: bigint;
  occurredOn: string;
  orderId: bigint;
  outcome: UploadedFileLineOutcome;
  reason: UploadedFileLineReason;
  detail: string;
  settlementLogId: bigint;
};

const SHOPEE_SHEET = "Rincian Transaksi";

export const settlementImportLines: ImportLine[] = [
  // 901 — Shopee. Held: a type nobody mapped, and a key another account already holds.
  { id: 9011n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "", platformType: "Biaya Program Baru", description: "Biaya program promosi September", settlementType: SettlementType.UNSPECIFIED, change: -15_000n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.HELD, reason: UploadedFileLineReason.UNMAPPED_TYPE, detail: "", settlementLogId: 0n },
  { id: 9012n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "240927QRST", platformType: "Penghasilan dari Pesanan", description: "Penghasilan dari pesanan 240927QRST", settlementType: SettlementType.FUND, change: 212_000n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.HELD, reason: UploadedFileLineReason.REFUSED, detail: "unique_id already names an entry on another account", settlementLogId: 0n },
  // Skipped: a withdrawal that failed, and the refund that returned it (only-a-successful-withdrawal-is-recorded).
  { id: 9013n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "", platformType: "Penarikan Dana", description: "Penarikan dana ke rekening — Gagal", settlementType: SettlementType.UNSPECIFIED, change: -5_899_085n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.SKIPPED, reason: UploadedFileLineReason.FAILED_WITHDRAWAL, detail: "", settlementLogId: 0n },
  { id: 9014n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "", platformType: "Penarikan Dana", description: "Pengembalian Dana untuk Penarikan Gagal", settlementType: SettlementType.UNSPECIFIED, change: 5_899_085n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.SKIPPED, reason: UploadedFileLineReason.FAILED_WITHDRAWAL, detail: "", settlementLogId: 0n },
  // Posted to the shop: their refs found no order (an-unmatched-ref-posts-to-the-shop).
  { id: 9015n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "240927ABCD", platformType: "Penghasilan dari Pesanan", description: "Penghasilan dari pesanan 240927ABCD", settlementType: SettlementType.FUND, change: 185_000n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.POSTED, reason: UploadedFileLineReason.NO_ORDER, detail: "", settlementLogId: 7001n },
  { id: 9016n, uploadedFileId: 901n, sheet: SHOPEE_SHEET, orderRef: "240927EFGH", platformType: "Penghasilan dari Pesanan", description: "Penghasilan dari pesanan 240927EFGH", settlementType: SettlementType.FUND, change: 92_500n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.POSTED, reason: UploadedFileLineReason.NO_ORDER, detail: "", settlementLogId: 7002n },

  // 902 — TikTok. Held: an adjustment type nobody mapped.
  { id: 9021n, uploadedFileId: 902n, sheet: "Order details", orderRef: "577001234567", platformType: "Seller shipping fee compensation", description: "Seller shipping fee compensation", settlementType: SettlementType.UNSPECIFIED, change: 8_000n, occurredOn: "2026-09-26", orderId: 0n, outcome: UploadedFileLineOutcome.HELD, reason: UploadedFileLineReason.UNMAPPED_TYPE, detail: "", settlementLogId: 0n },
  // Skipped: Earnings and GMV Pay Deduction repeat money the Order details rows already carry.
  { id: 9022n, uploadedFileId: 902n, sheet: "Withdrawal records", orderRef: "", platformType: "Earnings", description: "Earnings", settlementType: SettlementType.UNSPECIFIED, change: 4_210_000n, occurredOn: "2026-09-26", orderId: 0n, outcome: UploadedFileLineOutcome.SKIPPED, reason: UploadedFileLineReason.REPEATS_ORDER_DETAILS, detail: "", settlementLogId: 0n },
  { id: 9023n, uploadedFileId: 902n, sheet: "Withdrawal records", orderRef: "", platformType: "Earnings", description: "Earnings", settlementType: SettlementType.UNSPECIFIED, change: 3_985_000n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.SKIPPED, reason: UploadedFileLineReason.REPEATS_ORDER_DETAILS, detail: "", settlementLogId: 0n },
  { id: 9024n, uploadedFileId: 902n, sheet: "Withdrawal records", orderRef: "", platformType: "GMV Pay Deduction", description: "GMV Pay Deduction", settlementType: SettlementType.UNSPECIFIED, change: -412_500n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.SKIPPED, reason: UploadedFileLineReason.REPEATS_ORDER_DETAILS, detail: "", settlementLogId: 0n },
  { id: 9025n, uploadedFileId: 902n, sheet: "Order details", orderRef: "577009876543", platformType: "Order", description: "Order", settlementType: SettlementType.FUND, change: 156_000n, occurredOn: "2026-09-27", orderId: 0n, outcome: UploadedFileLineOutcome.POSTED, reason: UploadedFileLineReason.NO_ORDER, detail: "", settlementLogId: 7003n },
];
