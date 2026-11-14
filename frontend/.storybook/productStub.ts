// product_service as Storybook's stub — ProductService of warehouse.product.v1 — and the OWNER-SIDE figures the
// product screens read beside it: inventory's stock, cost layers, batches and movements, and selling's activity.
//
// The catalogue plays the server's rules (backend/services/product_service/product_v1):
//   a team lists its own       ProductList is scoped to the request's team; ACTIVE unless ARCHIVED is asked for.
//   the code is composed       create takes the team's PART and stores `<team_code>-<part>` (team 15, SL-03, types
//                              ANG-001 → SL-03-ANG-001); one code per row over EVERY row, archived ones included —
//                              a taken one is AlreadyExists (the-field-is-product-code-composed-on-write).
//   a correction needs no use  an edit may correct the part only of a product with no history; any other is
//                              FailedPrecondition. Sending the part it already has is no correction.
//   archive keeps the code     ProductArchive marks the row; ProductDetail still answers it (the page says
//                              "archived" and offers Unarchive), ProductByIds resolves it; Unarchive cannot collide.
//
// Seeded for the product stories, and ONLY for team 15 (Toko Anggrek, 44 products — no other story acts as it):
//   - two ARCHIVED products, here and not in fixtures.ts so no picker ever sees them — 790 the older pack of 700, under
//     a code of its own, and 791, the edition nobody ever stocked (the one product with no history);
//   - 700, the product the screens open, as a WHOLE record — two pictures, a description, a 12.5% markup, 4 held back;
//   - the figures below, invented but CONSISTENT: a product's ready stock is the sum of its batches' ready, its
//     cost range their unit costs, its layers one per batch still holding stock, its movements their receipts and
//     picks. Every sixth product has nothing on a shelf, SL-03-ANG-006, -012, -018 … came in ONE delivery (one price, not
//     a range), every fourth has a restock on its way.
//
// WRITEABLE: preview.tsx calls `resetProductStub()` in its `beforeEach`.

import { Code, ConnectError } from "@connectrpc/connect";

import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { BatchOrigin, MovementKind } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { ProductLockFilter, ProductRowSort, ProductStatus } from "../src/gen/warehouse/product/v1/product_pb";
import { SAMPLE_LOST_WAREHOUSE, SAMPLE_PRODUCTS, SAMPLE_SELLER } from "../src/features/analytic/sample";
import { productBatches, products as productFixtures, teams as teamFixtures, warehouseStock } from "./fixtures";
import { isEmptied, priceLogsOf, priceNow } from "./batchPriceScenario";
import { subtreeOf } from "./categoryStub";
import { discoverStockCalls, productDiscoverCalls, productListCalls, resetProductListCalls } from "./productListScenario";

type Image = { url: string; thumbnailUrl: string };
type ProductRow = (typeof productFixtures)[number] & { images: Image[] };

const FIGURED_TEAM = 15n;

/** An Analytic sample product as a by-ids row — undefined for any other id. */
function analyticSampleProduct(id: bigint): ProductRow | undefined {
  const sample = SAMPLE_PRODUCTS.find((p) => p.id === id.toString());
  if (!sample) return undefined;

  return {
    ...productFixtures[0]!,
    id,
    teamId: BigInt(SAMPLE_SELLER),
    productCode: `MEL-SMP-${sample.id}`,
    name: sample.name,
    archived: false,
    crossMarkupBps: 0,
    reservedStock: 0,
    images: [],
  };
}

const ARCHIVED: ProductRow[] = [
  {
    id: 790n, teamId: FIGURED_TEAM, productCode: "SL-03-ANG-001-L", name: "Minyak Goreng Sawit 2L — Kemasan Lama",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    archived: true, crossMarkupBps: 0, crossLocked: false, reservedStock: 0, images: [],
  },
  {
    id: 791n, teamId: FIGURED_TEAM, productCode: "SL-03-ANG-LAMA", name: "Kopi Sachet Isi 10 — Edisi Lama",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    archived: true, crossMarkupBps: 0, crossLocked: false, reservedStock: 0, images: [],
  },
];

// Flat drawings standing in for two photos of 700 — the front of the bottle and its label — so the detail page's
// gallery and the form's thumbnails have something to show. Inline, so no story waits on a network image.
const drawing = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 64 64">${body}</svg>`,
  )}`;
const MINYAK_FRONT = drawing(
  `<rect width="64" height="64" fill="#fef9c3"/>` +
    `<rect x="27" y="6" width="10" height="7" rx="2" fill="#dc2626"/>` +
    `<path d="M24 13h16l4 10v33a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V23z" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>` +
    `<rect x="22" y="30" width="20" height="14" rx="2" fill="#16a34a"/>`,
);
const MINYAK_LABEL = drawing(
  `<rect width="64" height="64" fill="#f0fdf4"/>` +
    `<rect x="12" y="12" width="40" height="40" rx="4" fill="#ffffff" stroke="#16a34a" stroke-width="1.5"/>` +
    `<rect x="18" y="20" width="28" height="3" rx="1" fill="#16a34a"/>` +
    `<rect x="18" y="28" width="22" height="2" rx="1" fill="#a3a3a3"/>` +
    `<rect x="18" y="34" width="25" height="2" rx="1" fill="#a3a3a3"/>` +
    `<rect x="18" y="40" width="16" height="2" rx="1" fill="#a3a3a3"/>`,
);

// 700 is the product the screens open, so it carries a whole record: a gallery, a description, a markup for another
// team and a hold-back. Its lock stays OFF — the list's lock story turns it on.
const MINYAK: Partial<ProductRow> = {
  description: "Minyak goreng kelapa sawit, botol 2 liter. Disimpan di rak kering, jauh dari sinar matahari.",
  crossMarkupBps: 1250,
  reservedStock: 4,
  images: [
    { url: MINYAK_FRONT, thumbnailUrl: MINYAK_FRONT },
    { url: MINYAK_LABEL, thumbnailUrl: MINYAK_LABEL },
  ],
};

let rows: ProductRow[] = [];

// Whether the Analytic sample's products are CATALOGUE rows for this story (`listAnalyticSampleProducts`) — off by
// default, so no other picker story meets them.
let analyticSamplesListed = false;

// The products with NO HISTORY — never stocked, ordered or restocked: 791, and whatever a story creates. Only these may
// be deleted, or have their code's part corrected, as the server's history reader decides (product_history.go).
let neverUsed = new Set<bigint>();

export function resetProductStub() {
  resetProductListCalls();
  rows = [...productFixtures.map((p) => ({ ...p, images: [] as Image[] })), ...ARCHIVED.map((p) => ({ ...p }))];
  neverUsed = new Set([791n]);
  analyticSamplesListed = false;

  const minyak = rows.find((r) => r.id === 700n)!;
  Object.assign(minyak, MINYAK, { images: [...MINYAK.images!] });
  withCover(minyak);
}

resetProductStub();

/**
 * Change one product for ONE story, from its `beforeEach`. The stub holds COPIES of the fixtures, so flipping a flag
 * on a fixture object no longer reaches it — and the next story's reset puts this back, with no cleanup to forget.
 */
export function patchProduct(productId: bigint, patch: Partial<ProductRow>) {
  Object.assign(rows.find((r) => r.id === productId)!, patch);
}

/**
 * A `beforeEach` (via productScenario's `withAnalyticSampleProducts`): the Analytic sample's products (201–206, Toko
 * Melati's — the ones Lost stock's stub loses) become Toko Melati's catalogue rows, and each counts as HELD in the
 * warehouse the sample lost it in (`analyticSamplesHeldHere`), so the composer's product filter can find them by the
 * real searches — ProductList for the seller, WarehouseProductSearch for the warehouse. The next story's reset takes
 * them away.
 */
export function listAnalyticSampleProducts() {
  if (analyticSamplesListed) return;

  analyticSamplesListed = true;
  for (const sample of SAMPLE_PRODUCTS) rows.push(analyticSampleProduct(BigInt(sample.id))!);
}

/** The Analytic sample's products held in this warehouse — none unless a story listed them. */
export function analyticSamplesHeldHere(warehouseId: bigint): bigint[] {
  if (!analyticSamplesListed) return [];

  return SAMPLE_PRODUCTS.filter((p) => SAMPLE_LOST_WAREHOUSE[p.id] === warehouseId.toString()).map((p) => BigInt(p.id));
}

/** The live catalogue — what every other stub (and every picker) reads. */
export const liveProducts = () => rows.filter((r) => !r.archived);

/** Every row, archived included — what productScenario's `productsNow()` hands the bundle stub and the order form. */
export const allProducts = () => rows;

type PageReq = { page?: bigint; limit?: bigint } | undefined;

function paged<R>(slice: string, all: R[], idOf: (r: R) => bigint, page: PageReq) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;
  const window = all.slice((current - 1) * limit, current * limit);
  const mapData: Record<string, R> = {};
  for (const row of window) mapData[idOf(row).toString()] = row;

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: window.map(idOf),
    // `currentPage` and `totalPage` are plain numbers on the wire; only `totalItems` is an int64.
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(all.length / limit)), totalItems: BigInt(all.length) },
  };
}

const matches = (q: string | undefined, ...fields: string[]) => {
  const term = (q ?? "").trim().toLowerCase();
  return term === "" || fields.some((f) => f.toLowerCase().includes(term));
};

function find(teamId: bigint, productId: bigint): ProductRow {
  const row = rows.find((r) => r.id === productId && r.teamId === teamId);
  if (!row) throw new ConnectError("product not found", Code.NotFound);
  return row;
}

// The stored code: the team's code, a dash, the team's part — composed by the server, never typed whole.
function composeCode(teamId: bigint, part: string): string {
  const teamCode = teamFixtures.find((t) => t.id === teamId)?.teamCode ?? "";
  if (teamCode === "") throw new ConnectError("the team has no team code to compose a product code with", Code.FailedPrecondition);
  return `${teamCode}-${part.trim()}`;
}

// One code per row, over EVERY row — an archived product keeps its code.
function requireFreeCode(productCode: string, self?: bigint) {
  if (rows.some((r) => r.productCode === productCode && r.id !== self)) {
    throw new ConnectError(
      "a product with this product code already exists — an archived one keeps its code, so check the archive too",
      Code.AlreadyExists,
    );
  }
}

// A declaration, not a const: the seed above calls it at module load, before this line runs.
function withCover(row: ProductRow) {
  row.defaultImageUrl = row.images[0]?.url ?? "";
  row.defaultImageThumbnailUrl = row.images[0]?.thumbnailUrl ?? row.images[0]?.url ?? "";
}

export const productService = {
  // PAGED, because a caller genuinely walks it: OwnStockedProductPicker collects a team's whole catalogue 200 ids at a
  // time and stops on a short page. In the fixtures' own order (the server sorts newest first unless asked), so the
  // pickers' stories keep their first rows; a sort by name or SKU is honoured.
  //
  // THE LOCK AND THE STOCK'S AGE are narrowed here as the server does (stock_narrower.go, over inventory's batches through
  // the composition root): a way of the lock reads the two fields; LOCKED_NOW is a minimum with the ready stock of EVERY
  // warehouse under it (a-minimum-closes-only-under-it — at exactly it, open; nothing on a shelf is under any); an age
  // keeps a product whose oldest READY batch in the lens (`stockWarehouseId`, 0 = every one) arrived at least N whole days
  // before now — the clock the Umur stok column reads, so the filter and the column agree. Each request is recorded
  // (productListScenario.ts).
  productList: (req: {
    teamId: bigint;
    filter?: { q?: string; status?: ProductStatus; lock?: ProductLockFilter; stockAgeMinDays?: number };
    stockWarehouseId?: bigint;
    sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
    page?: PageReq;
  }) => {
    const archived = req.filter?.status === ProductStatus.ARCHIVED;
    const lock = req.filter?.lock ?? ProductLockFilter.UNSPECIFIED;
    const days = req.filter?.stockAgeMinDays ?? 0;
    const lens = req.stockWarehouseId ?? 0n;
    productListCalls.push({
      teamId: req.teamId,
      q: req.filter?.q ?? "",
      lock,
      stockAgeMinDays: days,
      stockWarehouseId: lens,
      limit: Number(req.page?.limit ?? 0),
    });
    const by = req.sort?.s?.case === "product" ? (req.sort.s.value as ProductRowSort) : ProductRowSort.UNSPECIFIED;
    const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;
    const list = rows
      .filter((p) => p.teamId === req.teamId && p.archived === archived && matches(req.filter?.q, p.name, p.productCode))
      .filter((p) => inLockWay(p, lock) && agedAtLeast(p.id, days, lens))
      .sort((a, b) =>
        by === ProductRowSort.NAME
          ? a.name.localeCompare(b.name) * dir
          : by === ProductRowSort.PRODUCT_CODE
            ? a.productCode.localeCompare(b.productCode) * dir
            : 0,
      );
    return paged("product", list, (p) => p.id, req.page);
  },

  // Discovery looks ACROSS teams — `team_id` is an authorization scope here and must NOT narrow the rows. Its two
  // real narrowings apply (the in-dialog team filter, "other teams only"), and an EMPTY id list is no narrowing.
  // A sort by name or SKU is honoured, as productList's is; without one, the fixtures' own order.
  //
  // KUNCI as the server narrows it (discover-filters-by-lock, stock_narrower.go): CLOSED = locked by its owner, or a
  // minimum the ready stock of EVERY warehouse is UNDER (the same figures DiscoverStockByIds answers the cards with);
  // ORDERABLE = every other. The list's own lock values are refused here, as the server refuses them. Each request is
  // recorded (productListScenario.ts).
  //
  // GUDANG, STOK SIAP, HARGA CROSS AND KATEGORI as the server narrows them (discover_narrowing.go), over the very figures
  // DiscoverStockByIds answers the cards with (`discoverStockSample`), so a card never contradicts the filter that kept
  // it: a warehouse keeps what holds ready units there; the ready range and the cross range read that warehouse (or
  // every one), both ends included, no max = open; a product with nothing ready has no cross price; a category keeps
  // its whole subtree (categoryStub `subtreeOf`).
  productDiscover: (req: {
    teamId: bigint;
    ownerTeamId: bigint;
    excludeOwnTeam: boolean;
    includeLocked: boolean;
    ownerTeamIds: bigint[];
    excludeOwnerTeamIds: bigint[];
    filter?: { q?: string; lock?: ProductLockFilter; stockAgeMinDays?: number };
    sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
    page?: PageReq;
    warehouseId?: bigint;
    categoryId?: bigint;
    ready?: { min: bigint; max?: bigint };
    crossPrice?: { min: number; max?: number };
  }) => {
    const by = req.sort?.s?.case === "product" ? (req.sort.s.value as ProductRowSort) : ProductRowSort.UNSPECIFIED;
    const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;
    const lock = req.filter?.lock ?? ProductLockFilter.UNSPECIFIED;
    const warehouseId = req.warehouseId ?? 0n;
    const categoryId = req.categoryId ?? 0n;
    productDiscoverCalls.push({
      lock,
      includeLocked: req.includeLocked,
      limit: Number(req.page?.limit ?? 0),
      warehouseId,
      categoryId,
      ready: req.ready ? { min: req.ready.min, max: req.ready.max } : undefined,
      crossPrice: req.crossPrice ? { min: req.crossPrice.min, max: req.crossPrice.max } : undefined,
    });
    const inCategory = categoryId === 0n ? undefined : subtreeOf(categoryId);
    if (
      (lock !== ProductLockFilter.UNSPECIFIED && lock !== ProductLockFilter.CLOSED && lock !== ProductLockFilter.ORDERABLE) ||
      (req.filter?.stockAgeMinDays ?? 0) > 0
    ) {
      throw new ConnectError("the lock's ways, the lock-now and the stock-age filters narrow a team's own product list only", Code.InvalidArgument);
    }

    return paged(
      "product",
      liveProducts()
        .filter(
          (p) =>
            // One its owner locked only when asked — the Discover page asks, a picker never does (product_discover.go,
            // a-locked-product-shows-on-discover). An archived one is already gone: this reads the live catalogue.
            (req.includeLocked || !p.crossLocked) &&
            (req.ownerTeamId === 0n || p.teamId === req.ownerTeamId) &&
            (!req.excludeOwnTeam || p.teamId !== req.teamId) &&
            (req.ownerTeamIds.length === 0 || req.ownerTeamIds.includes(p.teamId)) &&
            (req.excludeOwnerTeamIds.length === 0 || !req.excludeOwnerTeamIds.includes(p.teamId)) &&
            matches(req.filter?.q, p.name, p.productCode) &&
            inDiscoverLock(p, lock) &&
            (inCategory === undefined || inCategory.includes(p.categoryId)) &&
            onDiscoverShelf(p, warehouseId, req.ready, req.crossPrice),
        )
        .sort((a, b) =>
          by === ProductRowSort.NAME
            ? a.name.localeCompare(b.name) * dir
            : by === ProductRowSort.PRODUCT_CODE
              ? a.productCode.localeCompare(b.productCode) * dir
              : 0,
        ),
      (p) => p.id,
      req.page,
    );
  },

  // Any team's, archived or not — an unknown id is simply ABSENT. The Analytic sample's products (201–206, Toko
  // Melati's, the ones Lost stock's stub loses) are answered too, by-ids only, so a served product row is named by this
  // lookup as on the server — never a catalogue row, so no list or picker sees them, unless a story lists them
  // (`listAnalyticSampleProducts`, for the Analytic product filter).
  productByIds: (req: { filter?: { ids?: bigint[] } }) => {
    const items: Record<string, unknown> = {};
    for (const id of req.filter?.ids ?? []) {
      const row = rows.find((r) => r.id === id) ?? analyticSampleProduct(id);
      if (row) items[id.toString()] = { items: [{ d: { case: "product", value: { mapData: { [id.toString()]: row } } } }] };
    }
    return { items };
  },

  productDetail: (req: { teamId: bigint; productId: bigint }) => ({ product: find(req.teamId, req.productId) }),

  productCreate: (req: {
    teamId: bigint;
    productCodePart: string;
    name: string;
    description: string;
    categoryId: bigint;
    // A plain list on create — only the update wraps it, to tell "leave alone" from "replace".
    images?: Image[];
    crossMarkupBps: number;
    crossLocked: boolean;
    reservedStock: number;
  }) => {
    const productCode = composeCode(req.teamId, req.productCodePart);
    requireFreeCode(productCode);
    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    neverUsed.add(id);
    const row: ProductRow = {
      id, teamId: req.teamId, productCode, name: req.name, description: req.description, categoryId: req.categoryId,
      defaultImageUrl: "", defaultImageThumbnailUrl: "", archived: false, crossMarkupBps: req.crossMarkupBps,
      crossLocked: req.crossLocked, reservedStock: req.reservedStock, images: (req.images ?? []).map((im) => ({ ...im })),
    };
    withCover(row);
    rows.push(row);
    return { product: row };
  },

  // Absent = leave alone; `images` is a wrapper, so present = replace with exactly these.
  productUpdate: (req: {
    teamId: bigint;
    productId: bigint;
    productCodePart?: string;
    name?: string;
    description?: string;
    categoryId?: bigint;
    images?: { items?: Image[] };
    crossMarkupBps?: number;
    crossLocked?: boolean;
    reservedStock?: number;
  }) => {
    const row = find(req.teamId, req.productId);
    // A correction of the code: only while the product has no history, and refused before anything else lands.
    const productCode = req.productCodePart !== undefined ? composeCode(req.teamId, req.productCodePart) : row.productCode;
    if (productCode !== row.productCode) {
      if (!neverUsed.has(row.id)) {
        throw new ConnectError(
          "this product has a history — a stock movement, an order line or a restock line — so its code is fixed",
          Code.FailedPrecondition,
        );
      }
      requireFreeCode(productCode, row.id);
      row.productCode = productCode;
    }
    if (req.name !== undefined) row.name = req.name;
    if (req.description !== undefined) row.description = req.description;
    if (req.categoryId !== undefined) row.categoryId = req.categoryId;
    if (req.crossMarkupBps !== undefined) row.crossMarkupBps = req.crossMarkupBps;
    if (req.crossLocked !== undefined) row.crossLocked = req.crossLocked;
    if (req.reservedStock !== undefined) row.reservedStock = req.reservedStock;
    if (req.images) {
      row.images = [...(req.images.items ?? [])];
      withCover(row);
    }
    return { product: row };
  },

  productArchive: (req: { teamId: bigint; productId: bigint }) => {
    find(req.teamId, req.productId).archived = true;
    return {};
  },

  // DELETE (a-used-product-is-archived-never-deleted): a product WITH HISTORY is refused, as the server refuses it. In the
  // samples every product has one but SL-03-ANG-LAMA, the edition nobody ever stocked — and whatever a story created.
  productDelete: (req: { teamId: bigint; productId: bigint }) => {
    const row = find(req.teamId, req.productId);
    if (!neverUsed.has(row.id)) {
      throw new ConnectError(
        "this product has a history — a stock movement, an order line or a restock line — so it cannot be deleted: archive it instead",
        Code.FailedPrecondition,
      );
    }
    rows = rows.filter((r) => r !== row);
    return {};
  },

  // Same id, same code: an archived product kept its code, so the way back cannot collide.
  productUnarchive: (req: { teamId: bigint; productId: bigint }) => {
    const row = find(req.teamId, req.productId);
    row.archived = false;
    return { product: row };
  },
};

// ── The owner-side figures, for team 15's catalogue ──────────────────────────────────────────────────────────────

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const NOW = BigInt(Date.UTC(2026, 9, 8) / 1000);
const GUDANG_PUSAT = 11n;
const GUDANG_CABANG = 14n;

interface SampleBatch {
  id: bigint;
  warehouseId: bigint;
  arrived: bigint;
  ready: bigint;
  unitCost: number;
  acceptedAt: bigint;
}

const figured = (productId: bigint) => {
  const row = liveProducts().find((r) => r.id === productId);
  return row && row.teamId === FIGURED_TEAM ? row : undefined;
};

/**
 * A product's batches as the reads answer them — as minted, unless a Koreksi Harga story corrected one's price or emptied
 * it (batchPriceScenario.ts). Every other story reads the minted set.
 */
function batchesOf(productId: bigint): SampleBatch[] {
  return mintedBatchesOf(productId).map((b) => ({
    ...b,
    unitCost: priceNow(b.id, b.unitCost),
    ready: isEmptied(b.id) ? 0n : b.ready,
  }));
}

/** One batch's facts for BatchRevalue's stub (batchPriceStub.ts) — `undefined` for one not sampled here. */
export function sampleBatchForPrice(batchId: bigint) {
  const productId = batchId / 10n;
  const minted = mintedBatchesOf(productId).find((b) => b.id === batchId);
  const b = batchesOf(productId).find((x) => x.id === batchId);
  if (!minted || !b) return undefined;
  return {
    teamId: FIGURED_TEAM,
    warehouseId: b.warehouseId,
    productId,
    units: b.ready,
    price: b.unitCost,
    value: Number(b.ready) * b.unitCost,
    minted: minted.unitCost,
  };
}

/** A product's batches as minted — none for every sixth; one or two in Gudang Pusat and one in Gudang Cabang otherwise. */
function mintedBatchesOf(productId: bigint): SampleBatch[] {
  if (!figured(productId)) return [];
  const n = Number(productId % 997n);
  if (n % 6 === 0) return [];
  const cost = 8_000 + ((n * 911) % 40_000);
  const first: SampleBatch = { id: productId * 10n + 1n, warehouseId: GUDANG_PUSAT, arrived: 60n, ready: BigInt(10 + ((n * 7) % 40)), unitCost: cost, acceptedAt: NOW - BigInt(20 + (n % 30)) * DAY };
  // ONE DELIVERY, so ONE PRICE — ids 705, 711, 717 … (SL-03-ANG-006, -012, -018 …), so the list shows a single cost beside
  // the ranges rather than a range on every row.
  if (n % 6 === 3) return [first];
  const out: SampleBatch[] = [
    first,
    { id: productId * 10n + 2n, warehouseId: GUDANG_CABANG, arrived: 40n, ready: BigInt(5 + ((n * 11) % 30)), unitCost: cost + 1_500, acceptedAt: NOW - BigInt(5 + (n % 10)) * DAY },
  ];
  if (n % 2 === 0) {
    out.push({ id: productId * 10n + 3n, warehouseId: GUDANG_PUSAT, arrived: 24n, ready: 24n, unitCost: cost + 800, acceptedAt: NOW - BigInt(1 + (n % 4)) * DAY });
  }
  return out;
}

const inLens = (warehouseId: bigint | undefined) => (b: SampleBatch) => !warehouseId || b.warehouseId === warehouseId;

/**
 * What one warehouse's shelves hold of a team-15 product — its batches there, added up — so StockAvailability agrees with
 * the owner's own figures (the discover detail reads both). `undefined` for a product not figured, which keeps the
 * fixtures' shelf rule.
 */
export function shelfSample(productId: bigint, warehouseId: bigint): bigint | undefined {
  if (!figured(productId)) return undefined;
  return batchesOf(productId)
    .filter(inLens(warehouseId))
    .reduce((s, b) => s + b.ready, 0n);
}

/** The OwnerStockItem a product's batches add up to, in a warehouse lens — `undefined` for a product not figured. */
export function ownerStockSample(productId: bigint, teamId: bigint, warehouseId: bigint | undefined) {
  if (teamId !== FIGURED_TEAM || !figured(productId)) return undefined;
  const n = Number(productId % 997n);
  const held = batchesOf(productId).filter(inLens(warehouseId)).filter((b) => b.ready > 0n);
  const costs = held.map((b) => b.unitCost);
  const ongoingQty = n % 4 === 0 ? BigInt(12 + (n % 20)) : 0n;
  return {
    readyQty: held.reduce((s, b) => s + b.ready, 0n),
    readyValue: held.reduce((s, b) => s + Number(b.ready) * b.unitCost, 0),
    ongoingQty,
    ongoingValueEst: Number(ongoingQty) * (costs[0] ?? 10_000),
    costMin: costs.length ? costs.reduce((a, b) => (b < a ? b : a)) : 0,
    costMax: costs.length ? costs.reduce((a, b) => (b > a ? b : a)) : 0,
    costKnown: costs.length > 0,
    oldestBatchUnix: held.length ? held.reduce((a, b) => (b.acceptedAt < a ? b.acceptedAt : a), held[0]!.acceptedAt) : 0n,
    lastRestockUnix: batchesOf(productId).reduce((a, b) => (b.acceptedAt > a ? b.acceptedAt : a), 0n),
  };
}

// ── Discover's card figures (DiscoverStockByIds) ──────────────────────────────────────────────────────────────────────

/**
 * What DiscoverStockByIds answers for one product, whoever asks — its OWNER's batches, as the server reads them: team 15's
 * catalogue from its sample batches (both warehouses), the fixture products from the fixture shelf (`warehouseStock`,
 * `productBatches` — Gudang Pusat only). On its way: team 15's every fourth, and Teh's 6 — bound for Gudang Pusat. The
 * cross price is the cost spread of the batches holding units in the lens with the product's markup on top; the cost
 * itself is never returned. `warehouseId` 0n = every warehouse; the total is every warehouse's whatever it says.
 */
export function discoverStockSample(productId: bigint, warehouseId: bigint) {
  const row = rows.find((r) => r.id === productId);
  const bps = row?.crossMarkupBps ?? 0;
  const lensed = (w: bigint) => warehouseId === 0n || w === warehouseId;

  let held: { warehouseId: bigint; ready: bigint; unitCost: number }[] = [];
  let ongoing = 0n;

  if (figured(productId)) {
    held = batchesOf(productId).filter((b) => b.ready > 0n);
    const n = Number(productId % 997n);
    ongoing = n % 4 === 0 ? BigInt(12 + (n % 20)) : 0n;
  } else if (row) {
    const key = productId.toString();
    held = (productBatches[key] ?? [])
      .filter((b) => b.quantity > 0n)
      .map((b) => ({ warehouseId: GUDANG_PUSAT, ready: b.quantity, unitCost: b.unitCost }));
    // The fixture shelf's own figure wins where the two disagree.
    if (held.length === 0 && (warehouseStock[key] ?? 0n) > 0n) {
      held = [{ warehouseId: GUDANG_PUSAT, ready: warehouseStock[key]!, unitCost: 0 }];
    }
    ongoing = key === "72" ? 6n : 0n;
  }

  const inLensHeld = held.filter((b) => lensed(b.warehouseId));
  // A fixture shelf's 0 is UNKNOWN, never free (fixtures.ts `productCosts`), so it prices nothing — the own product's
  // cost beside it reads a dash too.
  const costs = inLensHeld.map((b) => b.unitCost).filter((c) => figured(productId) || c > 0);
  const priced = (c: number) => c + (c * bps) / 10_000;

  return {
    productId,
    readyQty: inLensHeld.reduce((s, b) => s + b.ready, 0n),
    ongoingQty: lensed(GUDANG_PUSAT) ? ongoing : 0n,
    totalReadyQty: held.reduce((s, b) => s + b.ready, 0n),
    crossKnown: costs.length > 0,
    crossMin: costs.length ? priced(Math.min(...costs)) : 0,
    crossMax: costs.length ? priced(Math.max(...costs)) : 0,
  };
}

/** DiscoverStockByIds — one row per id asked, in the order asked, zeros included. Each call is recorded. */
export function discoverStockByIds(req: { teamId: bigint; productIds: bigint[]; warehouseId: bigint }) {
  discoverStockCalls.push({ productIds: [...req.productIds], warehouseId: req.warehouseId });
  return { items: req.productIds.map((id) => discoverStockSample(id, req.warehouseId)) };
}

/**
 * Whether a product passes Discover's Gudang, Stok siap and Harga cross — over the figures DiscoverStockByIds answers in
 * that warehouse (or every one). Never stocked reads 0 ready, so a range from 0 keeps it — but no warehouse and no cross
 * band does: it holds nothing there and has no price.
 */
function onDiscoverShelf(
  p: ProductRow,
  warehouseId: bigint,
  ready?: { min: bigint; max?: bigint },
  cross?: { min: number; max?: number },
): boolean {
  if (warehouseId === 0n && !ready && !cross) return true;
  const s = discoverStockSample(p.id, warehouseId);
  if (warehouseId !== 0n && s.readyQty === 0n) return false;
  if (ready && (s.readyQty < ready.min || (ready.max !== undefined && s.readyQty > ready.max))) return false;
  if (cross && (!s.crossKnown || s.crossMax < cross.min || (cross.max !== undefined && s.crossMin > cross.max))) return false;
  return true;
}

/** Whether a product is in Discover's Kunci pick — CLOSED: locked, or a minimum the every-warehouse total is under. */
function inDiscoverLock(p: ProductRow, lock: ProductLockFilter): boolean {
  if (lock !== ProductLockFilter.CLOSED && lock !== ProductLockFilter.ORDERABLE) return true;
  const closed =
    p.crossLocked || (p.reservedStock > 0 && discoverStockSample(p.id, 0n).totalReadyQty < BigInt(p.reservedStock));
  return lock === ProductLockFilter.CLOSED ? closed : !closed;
}

/** Whether a product's lock is the asked way — or, LOCKED_NOW, a minimum its ready stock in every warehouse is under. */
function inLockWay(p: ProductRow, lock: ProductLockFilter): boolean {
  const minimum = !p.crossLocked && p.reservedStock > 0;
  switch (lock) {
    case ProductLockFilter.MODE_OPEN:
      return !p.crossLocked && p.reservedStock === 0;
    case ProductLockFilter.MODE_MINIMUM:
      return minimum;
    case ProductLockFilter.MODE_ALWAYS:
      return p.crossLocked;
    case ProductLockFilter.LOCKED_NOW:
      return minimum && batchesOf(p.id).reduce((s, b) => s + b.ready, 0n) < BigInt(p.reservedStock);
    default:
      return true;
  }
}

/** Whether a product's oldest READY batch in the lens arrived at least `days` whole days ago — none on a shelf, no age. */
function agedAtLeast(productId: bigint, days: number, lens: bigint): boolean {
  if (days <= 0) return true;
  const cutoff = BigInt(Math.floor(Date.now() / 1000)) - BigInt(days) * DAY;
  return batchesOf(productId).some((b) => inLens(lens)(b) && b.ready > 0n && b.acceptedAt <= cutoff);
}

/** OwnerStockStat — the whole figured catalogue added up, in a lens; nothing for any other team. */
export function ownerStockStat(req: { teamId: bigint; filter?: { warehouseId?: bigint } }) {
  if (req.teamId !== FIGURED_TEAM) return { preview: undefined };
  const all = liveProducts()
    .filter((p) => p.teamId === FIGURED_TEAM)
    .map((p) => ownerStockSample(p.id, FIGURED_TEAM, req.filter?.warehouseId)!);
  return {
    preview: {
      readyQty: all.reduce((s, x) => s + x.readyQty, 0n),
      readyValue: all.reduce((s, x) => s + x.readyValue, 0),
      ongoingQty: all.reduce((s, x) => s + x.ongoingQty, 0n),
      ongoingValueEst: all.reduce((s, x) => s + x.ongoingValueEst, 0),
      lastRestockUnix: all.reduce((a, x) => (x.lastRestockUnix > a ? x.lastRestockUnix : a), 0n),
    },
  };
}

/** When a product last sold and how many in 30 days — every seventh has never sold. */
function activityOf(productId: bigint) {
  if (!figured(productId)) return undefined;
  const n = Number(productId % 997n);
  if (n % 7 === 0) return { lastOrderUnix: 0n, soldQty30d: 0n };
  return { lastOrderUnix: NOW - BigInt(n % 9) * DAY - BigInt((n * 37) % 80_000), soldQty30d: BigInt(3 + ((n * 13) % 80)) };
}

export function orderProductActivityByIds(req: { teamId: bigint; filter?: { productIds?: bigint[] } }) {
  const items: Record<string, unknown> = {};
  if (req.teamId !== FIGURED_TEAM) return { items };
  for (const id of req.filter?.productIds ?? []) {
    const row = activityOf(id);
    if (row) items[id.toString()] = { items: [{ d: { case: "activity", value: { mapData: { [id.toString()]: row } } } }] };
  }
  return { items };
}

export function orderActivityStat(req: { teamId: bigint }) {
  if (req.teamId !== FIGURED_TEAM) return { preview: undefined };
  const all = liveProducts()
    .filter((p) => p.teamId === FIGURED_TEAM)
    .map((p) => activityOf(p.id)!);
  return {
    preview: {
      lastOrderUnix: all.reduce((a, x) => (x.lastOrderUnix > a ? x.lastOrderUnix : a), 0n),
      orders30d: all.reduce((s, x) => s + x.soldQty30d, 0n) / 3n,
    },
  };
}

/** OwnerCostLayerList — one layer per batch still holding stock, in the lens. */
export function ownerCostLayerList(req: { teamId: bigint; filter?: { productId?: bigint; warehouseId?: bigint }; page?: PageReq }) {
  const held = req.teamId === FIGURED_TEAM ? batchesOf(req.filter?.productId ?? 0n).filter(inLens(req.filter?.warehouseId)).filter((b) => b.ready > 0n) : [];
  const layers = held.map((b) => ({ id: b.id, unitCost: b.unitCost, costKnown: true, onHand: b.ready, amount: Number(b.ready) * b.unitCost }));
  return { ...paged("layer", layers, (l) => l.id, req.page), totalValue: layers.reduce((s, l) => s + l.amount, 0) };
}

/** OwnerBatchList — the product's deliveries, newest first, in the lens. */
export function ownerBatchList(req: { teamId: bigint; filter?: { productId?: bigint; warehouseId?: bigint }; page?: PageReq }) {
  const product = figured(req.filter?.productId ?? 0n);
  const list = req.teamId === FIGURED_TEAM && product
    ? batchesOf(product.id)
        .filter(inLens(req.filter?.warehouseId))
        .sort((a, b) => (a.acceptedAt > b.acceptedAt ? -1 : 1))
        .map((b) => ({
          id: b.id,
          deliveryId: b.id,
          receiptNo: `RST-${b.id}`,
          productId: product.id,
          productCode: product.productCode,
          name: product.name,
          supplierId: 0n,
          unitCost: b.unitCost,
          costKnown: true,
          arrived: b.arrived,
          broken: 0n,
          used: b.arrived - b.ready,
          ready: b.ready,
          lost: 0n,
          lineCost: Number(b.arrived) * b.unitCost,
          readyValue: Number(b.ready) * b.unitCost,
          expiresOnUnix: b.acceptedAt + 365n * DAY,
          createdAtUnix: b.acceptedAt - 3n * DAY,
          acceptedAtUnix: b.acceptedAt,
          createdBy: 61n,
          acceptedBy: 64n,
          origin: BatchOrigin.RESTOCK,
          warehouseId: b.warehouseId,
        }))
    : [];
  return { ...paged("batch", list, (b) => b.id, req.page), readyValueTotal: list.reduce((s, b) => s + b.readyValue, 0) };
}

/** OwnerStockHistory — each batch's receipt and what was picked from it since, newest first, a running balance. */
export function ownerStockHistory(req: { teamId: bigint; filter?: { productId?: bigint; warehouseId?: bigint }; page?: PageReq }) {
  const product = figured(req.filter?.productId ?? 0n);
  if (req.teamId !== FIGURED_TEAM || !product) return paged("movement", [], (m: { id: bigint }) => m.id, req.page);

  const events = batchesOf(product.id)
    .filter(inLens(req.filter?.warehouseId))
    .flatMap((b) => {
      const out: {
        batch: SampleBatch;
        kind: MovementKind;
        delta: bigint;
        at: bigint;
        ref: string;
        logId?: bigint;
        reason?: string;
        actor?: bigint;
        correction?: ReturnType<typeof priceLogsOf>[number];
      }[] = [{ batch: b, kind: MovementKind.RECEIVE, delta: b.arrived, at: b.acceptedAt, ref: `RST-${b.id}` }];
      if (b.arrived > b.ready) {
        out.push({ batch: b, kind: MovementKind.PICK, delta: -(b.arrived - b.ready), at: b.acceptedAt + 2n * DAY, ref: `ORD-${b.id}` });
      }
      // Each Koreksi Harga is a row that moved no unit (a batch_logs row, change_count 0), read as REVALUATION with its
      // price before and after and the value change (ledger_history.go). None unless a story corrected the batch.
      for (const l of priceLogsOf(b.id)) {
        out.push({ batch: b, kind: MovementKind.REVALUATION, delta: 0n, at: l.atUnix, ref: "", logId: l.id, reason: l.reason, actor: l.actorUserId, correction: l });
      }
      return out;
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  // Every row carries its batch's price and the value it moved, as the server's do — each batch from its minted price.
  const priceOf = new Map<string, number>();
  const mintedPrice = (b: SampleBatch) => mintedBatchesOf(product.id).find((m) => m.id === b.id)?.unitCost ?? b.unitCost;

  let balance = 0n;
  const movements = events
    .map((e, i) => {
      balance += e.delta;
      const before = priceOf.get(e.batch.id.toString()) ?? mintedPrice(e.batch);
      const after = e.correction ? e.correction.to : before;
      priceOf.set(e.batch.id.toString(), after);
      return {
        id: e.logId ?? product.id * 100n + BigInt(i + 1),
        movementId: e.logId ?? product.id * 100n + BigInt(i + 1),
        productId: product.id,
        warehouseId: e.batch.warehouseId,
        batchId: e.batch.id,
        kind: e.kind,
        delta: e.delta,
        balance,
        reason: e.reason ?? "",
        ref: e.ref,
        actorUserId: e.actor ?? 61n,
        createdAtUnix: e.at,
        isOverride: e.correction?.isOverride ?? false,
        priceUnitBefore: before,
        priceUnitAfter: after,
        valueChange: e.correction ? e.correction.valueDelta : Number(e.delta) * after,
      };
    })
    .reverse();
  return paged("movement", movements, (m) => m.id, req.page);
}
