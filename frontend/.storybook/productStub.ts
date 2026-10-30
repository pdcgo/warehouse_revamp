// product_service as Storybook's stub — ProductService of warehouse.product.v1 — and the OWNER-SIDE figures the
// product screens read beside it: inventory's stock, cost layers, batches and movements, and selling's activity.
//
// The catalogue plays the server's rules (backend/services/product_service/product_v1):
//   a team lists its own       ProductList is scoped to the request's team; ACTIVE unless ARCHIVED is asked for.
//   a SKU once among the live  create, edit and restore refuse a SKU an ACTIVE product of the team holds
//                              (AlreadyExists); an archived product keeps its SKU, so a live one may reuse it.
//   archive is soft            ProductDelete marks the row; ProductDetail still answers it (the page says
//                              "archived" and offers Restore), ProductByIds resolves it.
//   restore can collide        restoring under a SKU a live product took meanwhile is AlreadyExists, naming the
//                              holder — the screen then asks for a new SKU and restores under that.
//
// Seeded for the product stories, and ONLY for team 15 (Toko Anggrek, 44 products — no other story acts as it):
//   - two ARCHIVED products, here and not in fixtures.ts so no picker ever sees them — 790 holds SKU-ANG-001,
//     which the live 700 now uses (the restore collision), 791 restores cleanly;
//   - 700, the product the screens open, as a WHOLE record — two pictures, a description, a 12.5% markup, 4 held back;
//   - the figures below, invented but CONSISTENT: a product's ready stock is the sum of its batches' ready, its
//     cost range their unit costs, its layers one per batch still holding stock, its movements their receipts and
//     picks. Every sixth product has nothing on a shelf, SKU-ANG-006, -012, -018 … came in ONE delivery (one price, not
//     a range), every fourth has a restock on its way.
//
// WRITEABLE: preview.tsx calls `resetProductStub()` in its `beforeEach`.

import { Code, ConnectError } from "@connectrpc/connect";

import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { BatchOrigin, MovementKind } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { ProductRowSort, ProductStatus } from "../src/gen/warehouse/product/v1/product_pb";
import { products as productFixtures } from "./fixtures";

type Image = { url: string; thumbnailUrl: string };
type ProductRow = (typeof productFixtures)[number] & { images: Image[] };

const FIGURED_TEAM = 15n;

const ARCHIVED: ProductRow[] = [
  {
    id: 790n, teamId: FIGURED_TEAM, sku: "SKU-ANG-001", name: "Minyak Goreng Sawit 2L — Kemasan Lama",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: true, crossMarkupBps: 0, crossLocked: false, reservedStock: 0, images: [],
  },
  {
    id: 791n, teamId: FIGURED_TEAM, sku: "SKU-ANG-LAMA", name: "Kopi Sachet Isi 10 — Edisi Lama",
    description: "", categoryId: 54n, defaultImageUrl: "", defaultImageThumbnailUrl: "",
    deleted: true, crossMarkupBps: 0, crossLocked: false, reservedStock: 0, images: [],
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

export function resetProductStub() {
  rows = [...productFixtures.map((p) => ({ ...p, images: [] as Image[] })), ...ARCHIVED.map((p) => ({ ...p }))];

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

/** The live catalogue — what every other stub (and every picker) reads. */
export const liveProducts = () => rows.filter((r) => !r.deleted);

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

function requireFreeSku(teamId: bigint, sku: string, self?: bigint) {
  const holder = liveProducts().find((r) => r.teamId === teamId && r.sku === sku && r.id !== self);
  if (holder) throw new ConnectError("a product with this SKU already exists in the team", Code.AlreadyExists);
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
  productList: (req: {
    teamId: bigint;
    filter?: { q?: string; status?: ProductStatus };
    sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
    page?: PageReq;
  }) => {
    const archived = req.filter?.status === ProductStatus.ARCHIVED;
    const by = req.sort?.s?.case === "product" ? (req.sort.s.value as ProductRowSort) : ProductRowSort.UNSPECIFIED;
    const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;
    const list = rows
      .filter((p) => p.teamId === req.teamId && p.deleted === archived && matches(req.filter?.q, p.name, p.sku))
      .sort((a, b) =>
        by === ProductRowSort.NAME
          ? a.name.localeCompare(b.name) * dir
          : by === ProductRowSort.SKU
            ? a.sku.localeCompare(b.sku) * dir
            : 0,
      );
    return paged("product", list, (p) => p.id, req.page);
  },

  // Discovery looks ACROSS teams — `team_id` is an authorization scope here and must NOT narrow the rows. Its two
  // real narrowings apply (the in-dialog team filter, "other teams only"), and an EMPTY id list is no narrowing.
  // A sort by name or SKU is honoured, as productList's is; without one, the fixtures' own order.
  productDiscover: (req: {
    teamId: bigint;
    ownerTeamId: bigint;
    excludeOwnTeam: boolean;
    includeLocked: boolean;
    ownerTeamIds: bigint[];
    excludeOwnerTeamIds: bigint[];
    filter?: { q?: string };
    sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
    page?: PageReq;
  }) => {
    const by = req.sort?.s?.case === "product" ? (req.sort.s.value as ProductRowSort) : ProductRowSort.UNSPECIFIED;
    const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;

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
            matches(req.filter?.q, p.name, p.sku),
        )
        .sort((a, b) =>
          by === ProductRowSort.NAME
            ? a.name.localeCompare(b.name) * dir
            : by === ProductRowSort.SKU
              ? a.sku.localeCompare(b.sku) * dir
              : 0,
        ),
      (p) => p.id,
      req.page,
    );
  },

  // Any team's, archived or not — an unknown id is simply ABSENT.
  productByIds: (req: { filter?: { ids?: bigint[] } }) => {
    const items: Record<string, unknown> = {};
    for (const id of req.filter?.ids ?? []) {
      const row = rows.find((r) => r.id === id);
      if (row) items[id.toString()] = { items: [{ d: { case: "product", value: { mapData: { [id.toString()]: row } } } }] };
    }
    return { items };
  },

  productDetail: (req: { teamId: bigint; productId: bigint }) => ({ product: find(req.teamId, req.productId) }),

  productCreate: (req: {
    teamId: bigint;
    sku: string;
    name: string;
    description: string;
    categoryId: bigint;
    // A plain list on create — only the update wraps it, to tell "leave alone" from "replace".
    images?: Image[];
    crossMarkupBps: number;
    crossLocked: boolean;
    reservedStock: number;
  }) => {
    requireFreeSku(req.teamId, req.sku);
    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const row: ProductRow = {
      id, teamId: req.teamId, sku: req.sku, name: req.name, description: req.description, categoryId: req.categoryId,
      defaultImageUrl: "", defaultImageThumbnailUrl: "", deleted: false, crossMarkupBps: req.crossMarkupBps,
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
    sku?: string;
    name?: string;
    description?: string;
    categoryId?: bigint;
    images?: { items?: Image[] };
    crossMarkupBps?: number;
    crossLocked?: boolean;
    reservedStock?: number;
  }) => {
    const row = find(req.teamId, req.productId);
    if (req.sku !== undefined && req.sku !== row.sku) requireFreeSku(req.teamId, req.sku, row.id);
    if (req.sku !== undefined) row.sku = req.sku;
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

  productDelete: (req: { teamId: bigint; productId: bigint }) => {
    find(req.teamId, req.productId).deleted = true;
    return {};
  },

  productRestore: (req: { teamId: bigint; productId: bigint; sku?: string }) => {
    const row = find(req.teamId, req.productId);
    const sku = req.sku || row.sku;
    const holder = liveProducts().find((r) => r.teamId === req.teamId && r.sku === sku && r.id !== row.id);
    if (holder) throw new ConnectError(`sku taken: "${sku}" is held by "${holder.name}"`, Code.AlreadyExists);
    row.deleted = false;
    row.sku = sku;
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
  unitCost: bigint;
  acceptedAt: bigint;
}

const figured = (productId: bigint) => {
  const row = liveProducts().find((r) => r.id === productId);
  return row && row.teamId === FIGURED_TEAM ? row : undefined;
};

/** A product's batches — none for every sixth; one or two in Gudang Pusat and one in Gudang Cabang otherwise. */
function batchesOf(productId: bigint): SampleBatch[] {
  if (!figured(productId)) return [];
  const n = Number(productId % 997n);
  if (n % 6 === 0) return [];
  const cost = BigInt(8_000 + ((n * 911) % 40_000));
  const first: SampleBatch = { id: productId * 10n + 1n, warehouseId: GUDANG_PUSAT, arrived: 60n, ready: BigInt(10 + ((n * 7) % 40)), unitCost: cost, acceptedAt: NOW - BigInt(20 + (n % 30)) * DAY };
  // ONE DELIVERY, so ONE PRICE — ids 705, 711, 717 … (SKU-ANG-006, -012, -018 …), so the list shows a single cost beside
  // the ranges rather than a range on every row.
  if (n % 6 === 3) return [first];
  const out: SampleBatch[] = [
    first,
    { id: productId * 10n + 2n, warehouseId: GUDANG_CABANG, arrived: 40n, ready: BigInt(5 + ((n * 11) % 30)), unitCost: cost + 1_500n, acceptedAt: NOW - BigInt(5 + (n % 10)) * DAY },
  ];
  if (n % 2 === 0) {
    out.push({ id: productId * 10n + 3n, warehouseId: GUDANG_PUSAT, arrived: 24n, ready: 24n, unitCost: cost + 800n, acceptedAt: NOW - BigInt(1 + (n % 4)) * DAY });
  }
  return out;
}

const inLens = (warehouseId: bigint | undefined) => (b: SampleBatch) => !warehouseId || b.warehouseId === warehouseId;

/** The OwnerStockItem a product's batches add up to, in a warehouse lens — `undefined` for a product not figured. */
export function ownerStockSample(productId: bigint, teamId: bigint, warehouseId: bigint | undefined) {
  if (teamId !== FIGURED_TEAM || !figured(productId)) return undefined;
  const n = Number(productId % 997n);
  const held = batchesOf(productId).filter(inLens(warehouseId)).filter((b) => b.ready > 0n);
  const costs = held.map((b) => b.unitCost);
  const ongoingQty = n % 4 === 0 ? BigInt(12 + (n % 20)) : 0n;
  return {
    readyQty: held.reduce((s, b) => s + b.ready, 0n),
    readyValue: held.reduce((s, b) => s + b.ready * b.unitCost, 0n),
    ongoingQty,
    ongoingValueEst: ongoingQty * (costs[0] ?? 10_000n),
    costMin: costs.length ? costs.reduce((a, b) => (b < a ? b : a)) : 0n,
    costMax: costs.length ? costs.reduce((a, b) => (b > a ? b : a)) : 0n,
    costKnown: costs.length > 0,
    oldestBatchUnix: held.length ? held.reduce((a, b) => (b.acceptedAt < a ? b.acceptedAt : a), held[0]!.acceptedAt) : 0n,
    lastRestockUnix: batchesOf(productId).reduce((a, b) => (b.acceptedAt > a ? b.acceptedAt : a), 0n),
  };
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
      readyValue: all.reduce((s, x) => s + x.readyValue, 0n),
      ongoingQty: all.reduce((s, x) => s + x.ongoingQty, 0n),
      ongoingValueEst: all.reduce((s, x) => s + x.ongoingValueEst, 0n),
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
  const layers = held.map((b) => ({ id: b.id, unitCost: b.unitCost, costKnown: true, onHand: b.ready, amount: b.ready * b.unitCost }));
  return { ...paged("layer", layers, (l) => l.id, req.page), totalValue: layers.reduce((s, l) => s + l.amount, 0n) };
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
          sku: product.sku,
          name: product.name,
          supplierId: 0n,
          unitCost: b.unitCost,
          costKnown: true,
          arrived: b.arrived,
          broken: 0n,
          used: b.arrived - b.ready,
          ready: b.ready,
          lost: 0n,
          lineCost: b.arrived * b.unitCost,
          readyValue: b.ready * b.unitCost,
          expiresOnUnix: b.acceptedAt + 365n * DAY,
          createdAtUnix: b.acceptedAt - 3n * DAY,
          acceptedAtUnix: b.acceptedAt,
          createdBy: 61n,
          acceptedBy: 64n,
          origin: BatchOrigin.RESTOCK,
          warehouseId: b.warehouseId,
        }))
    : [];
  return { ...paged("batch", list, (b) => b.id, req.page), readyValueTotal: list.reduce((s, b) => s + b.readyValue, 0n) };
}

/** OwnerStockHistory — each batch's receipt and what was picked from it since, newest first, a running balance. */
export function ownerStockHistory(req: { teamId: bigint; filter?: { productId?: bigint; warehouseId?: bigint }; page?: PageReq }) {
  const product = figured(req.filter?.productId ?? 0n);
  if (req.teamId !== FIGURED_TEAM || !product) return paged("movement", [], (m: { id: bigint }) => m.id, req.page);

  const events = batchesOf(product.id)
    .filter(inLens(req.filter?.warehouseId))
    .flatMap((b) => {
      const out = [{ batch: b, kind: MovementKind.RECEIVE, delta: b.arrived, at: b.acceptedAt, ref: `RST-${b.id}` }];
      if (b.arrived > b.ready) {
        out.push({ batch: b, kind: MovementKind.PICK, delta: -(b.arrived - b.ready), at: b.acceptedAt + 2n * DAY, ref: `ORD-${b.id}` });
      }
      return out;
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  let balance = 0n;
  const movements = events
    .map((e, i) => {
      balance += e.delta;
      return {
        id: product.id * 100n + BigInt(i + 1),
        movementId: product.id * 100n + BigInt(i + 1),
        productId: product.id,
        warehouseId: e.batch.warehouseId,
        batchId: e.batch.id,
        kind: e.kind,
        delta: e.delta,
        balance,
        reason: "",
        ref: e.ref,
        actorUserId: 61n,
        createdAtUnix: e.at,
      };
    })
    .reverse();
  return paged("movement", movements, (m) => m.id, req.page);
}
