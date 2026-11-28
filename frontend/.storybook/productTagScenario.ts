// THE PRODUCT TAGS as Storybook's stub plays them (backlog #148, live since the-team-code-and-product-tags-prototype-is-
// accepted) — the server's rules of proto/warehouse/product/v1/product_tag.proto (backend #147), kept beside the product
// rows of productStub.ts, whose ProductList / ProductDetail carry `tags` and filter `tag_ids`; WarehouseStockList
// (warehouseStockListStub.ts) carries and filters them too; stubTransport.ts answers the eleven tag RPCs from here.
// The order tags' orderTagScenario.ts, for the products' own list:
//
//   products-have-their-own-tag-list (+ its 🔄 lines)
//       the PRODUCTS' OWN list — an order's or a restock's tags are other lists and never appear here; a name unique
//       trimmed, spaces folded, case ignored — creating one that exists answers THAT tag (created false), whatever its
//       type, never a twin; a CUSTOM tag by a product's writers (ProductUpdate's roles: the selling Owner and Admin, Root,
//       the Administrator) on the owning team's products; a SYSTEM tag, a rename, a delete and a system tag put on /
//       taken off only by Root / the Administrator (PermissionDenied); the APP's own tag (`need_reprint_code`, app task
//       `product.code.reprint`) is locked for everyone — never put on, taken off, renamed or deleted by hand
//       (FailedPrecondition); a rename onto another tag's name is AlreadyExists; a delete takes the tag off every product
//       and says how many.
//   who sees (🔄)
//       the owning team (ProductList, ProductDetail) and every warehouse holding the stock (WarehouseStockList,
//       ProductTagsByIds); never ProductByIds or ProductDiscover.
//
// The seed — the accepted #141 prototype's (its reprint world lives on in productReprintStub.ts), so the accepted stories
// read as they were drawn:
//
//   id   name               type     carried by
//   801  need_reprint_code  SYSTEM   (the app's, `product.code.reprint`) — 700 SL-03-ANG-001, 703 SL-03-ANG-004
//   804  Audit Admin        SYSTEM   an admin's — 703
//   802  Promo Lebaran      CUSTOM   700, 702 SL-03-ANG-003
//   803  Laris              CUSTOM   700, 704 SL-03-ANG-005, 74 SKU-BERAS-5K (Toko Melati's, held at Gudang Pusat)
//
// WRITEABLE, reset per story with the catalogue (productStub `resetProductStub`, from preview's beforeEach).

import { Code, ConnectError } from "@connectrpc/connect";

import { REPRINT_TAG_NAME, REPRINT_TAG_TASK, cleanTagName, tagNameKey } from "../src/features/products/tags/productTags";
import { ProductTagType } from "../src/gen/warehouse/product/v1/product_tag_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { sessionScenario } from "./sessionScenario";

/** The seed's tag ids — the accepted #141 prototype's. */
export const PRODUCT_TAG = { reprint: 801n, promo: 802n, laris: 803n, audit: 804n } as const;

/** The id the next tag made in a story takes. */
export const NEXT_PRODUCT_TAG_ID = 900n;

interface TagRow {
  id: bigint;
  name: string;
  type: ProductTagType;
  appTask: string;
}

const SEED: TagRow[] = [
  { id: PRODUCT_TAG.reprint, name: REPRINT_TAG_NAME, type: ProductTagType.SYSTEM, appTask: REPRINT_TAG_TASK },
  { id: PRODUCT_TAG.audit, name: "Audit Admin", type: ProductTagType.SYSTEM, appTask: "" },
  { id: PRODUCT_TAG.promo, name: "Promo Lebaran", type: ProductTagType.CUSTOM, appTask: "" },
  { id: PRODUCT_TAG.laris, name: "Laris", type: ProductTagType.CUSTOM, appTask: "" },
];

const SEED_ON: Record<string, bigint[]> = {
  "700": [PRODUCT_TAG.reprint, PRODUCT_TAG.laris, PRODUCT_TAG.promo],
  "702": [PRODUCT_TAG.promo],
  "703": [PRODUCT_TAG.reprint, PRODUCT_TAG.audit],
  "704": [PRODUCT_TAG.laris],
  "74": [PRODUCT_TAG.laris],
};

/** What the screens sent — every tag write, in order (the prototype's would-be requests, now the stub's). */
export type ProductTagCall =
  | { rpc: "ProductTagCreate"; teamId: bigint; name: string }
  | { rpc: "ProductTagSystemCreate"; name: string }
  | { rpc: "ProductTagAdd" | "ProductTagRemove" | "ProductSystemTagAdd" | "ProductSystemTagRemove"; productId: bigint; tagId: bigint }
  | { rpc: "ProductTagRename"; tagId: bigint; name: string }
  | { rpc: "ProductTagDelete"; tagId: bigint };

export const productTagScenario = {
  calls: [] as ProductTagCall[],
  /** The Tag filter each ProductList / WarehouseStockList was asked with, in order — a story reads what was SENT. */
  listTagIds: [] as bigint[][],
  /** How many times the products' tag list (ProductTagList) was read — a screen reads it once, and only when it offers it. */
  catalogueReads: 0,
  /** The ids each ProductTagsByIds was asked for, in order — the warehouse product page asks once. */
  byIdsCalls: [] as bigint[][],
};

/** The writes of one RPC, in order. */
export function productTagCallsOf<R extends ProductTagCall["rpc"]>(rpc: R): Extract<ProductTagCall, { rpc: R }>[] {
  return productTagScenario.calls.filter((c): c is Extract<ProductTagCall, { rpc: R }> => c.rpc === rpc);
}

let tags: TagRow[] = [];
/** product id → the tags it carries. */
let carried = new Map<string, bigint[]>();
let nextId = NEXT_PRODUCT_TAG_ID;

/** Back to the seed. */
export function resetProductTagScenario() {
  tags = SEED.map((tag) => ({ ...tag }));
  carried = new Map(Object.entries(SEED_ON).map(([id, ids]) => [id, [...ids]]));
  nextId = NEXT_PRODUCT_TAG_ID;
  productTagScenario.calls = [];
  productTagScenario.listTagIds = [];
  productTagScenario.catalogueReads = 0;
  productTagScenario.byIdsCalls = [];
}
resetProductTagScenario();

/**
 * For ONE story: the app takes its own tag off this product — the reprint's last warehouse printed (#151,
 * productReprintStub.ts calls it when a recorded print clears the last warehouse's wait). Recorded as no write: nobody
 * sent it.
 */
export function appTagOffForStory(productId: bigint) {
  const key = productId.toString();
  const app = new Set(tags.filter((tag) => tag.appTask !== "").map((tag) => tag.id));
  carried.set(key, (carried.get(key) ?? []).filter((id) => !app.has(id)));
}

// ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ordered = (list: TagRow[]) =>
  [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === ProductTagType.SYSTEM ? -1 : 1;
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : Number(a.id - b.id);
  });

const countOf = (tagId: bigint) => [...carried.values()].filter((ids) => ids.includes(tagId)).length;

function wire(tag: TagRow, withCount = false) {
  return {
    id: tag.id,
    name: tag.name,
    type: tag.type,
    productCount: withCount ? BigInt(countOf(tag.id)) : 0n,
    appTask: tag.appTask,
  };
}

/** A product's tags as its reads carry them (`Product.tags`, `ProductRowItem.tags`, the stock list's rows). */
export function tagsOnWire(productId: bigint) {
  const ids = carried.get(productId.toString()) ?? [];
  return ordered(tags.filter((tag) => ids.includes(tag.id))).map((tag) => wire(tag));
}

/** The lists' filter: no pick is any tag; else the product carries ANY of them. */
export function carriesAnyTag(productId: bigint, tagIds: readonly bigint[] | undefined): boolean {
  if (!tagIds || tagIds.length === 0) return true;
  const ids = carried.get(productId.toString()) ?? [];

  return tagIds.some((id) => ids.includes(id));
}

type PageReq = { page?: number; limit?: number } | undefined;

function paged(q: string, page: PageReq, withCount: boolean) {
  const needle = tagNameKey(q);
  const all = ordered(tags).filter((tag) => needle === "" || tagNameKey(tag.name).includes(needle));
  const limit = page?.limit || 20;
  const current = page?.page || 1;

  return {
    tags: all.slice((current - 1) * limit, current * limit).map((tag) => wire(tag, withCount)),
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(all.length / limit)), totalItems: BigInt(all.length) },
  };
}

export const listProductTags = (q: string, page: PageReq) => {
  productTagScenario.catalogueReads++;
  return paged(q, page, false);
};
export const manageProductTags = (q: string, page: PageReq) => paged(q, page, true);

// ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const ADMINS: readonly Role[] = [Role.ROOT, Role.ADMINISTRATOR];
/** ProductUpdate's roles — who writes on a product, and so who makes and puts on a custom tag. */
const WRITERS: readonly Role[] = [...ADMINS, Role.SELLING_OWNER, Role.SELLING_ADMIN];

/** The proto's request policy: an admin RPC refuses everyone but Root / the Administrator; a team's, all but a writer. */
export function refuseUnlessProductTagRole(admin: boolean) {
  const allowed = admin ? ADMINS : WRITERS;
  if (!allowed.includes(sessionScenario.role)) throw new ConnectError("permission denied", Code.PermissionDenied);
}

function tagById(tagId: bigint): TagRow {
  const tag = tags.find((t) => t.id === tagId);
  if (!tag) throw new ConnectError("product tag not found", Code.NotFound);

  return tag;
}

function refuseAppTag(tag: TagRow) {
  if (tag.appTask !== "") {
    throw new ConnectError("the app's own tag is put on and taken off by the app alone", Code.FailedPrecondition);
  }
}

/** Makes a tag — or answers the one that already carries the name, whatever its case or type (never a twin). */
export function createProductTag(name: string, type: ProductTagType, teamId?: bigint) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  productTagScenario.calls.push(
    type === ProductTagType.SYSTEM ? { rpc: "ProductTagSystemCreate", name: clean } : { rpc: "ProductTagCreate", teamId: teamId ?? 0n, name: clean },
  );

  const held = tags.find((tag) => tagNameKey(tag.name) === tagNameKey(clean));
  if (held) return { tag: wire(held), created: false };

  const tag: TagRow = { id: nextId++, name: clean, type, appTask: "" };
  tags.push(tag);

  return { tag: wire(tag), created: true };
}

export function renameProductTag(tagId: bigint, name: string) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  productTagScenario.calls.push({ rpc: "ProductTagRename", tagId, name: clean });

  const tag = tagById(tagId);
  refuseAppTag(tag);
  if (tags.some((other) => other.id !== tagId && tagNameKey(other.name) === tagNameKey(clean))) {
    throw new ConnectError("another product tag already carries this name", Code.AlreadyExists);
  }
  tag.name = clean;

  return { tag: wire(tag) };
}

export function deleteProductTag(tagId: bigint) {
  productTagScenario.calls.push({ rpc: "ProductTagDelete", tagId });

  const tag = tagById(tagId);
  refuseAppTag(tag);
  const productCount = BigInt(countOf(tagId));
  tags = tags.filter((t) => t.id !== tagId);
  for (const [id, ids] of carried) carried.set(id, ids.filter((t) => t !== tagId));

  return { productCount };
}

/**
 * Puts `tagId` on the product (on) or takes it off — the caller's team already checked as its owner (stubTransport).
 * `admin` is the admins' RPC (a system tag); otherwise the team's (a custom tag). Already on / not on is no change.
 */
export function setProductTag(productId: bigint, tagId: bigint, admin: boolean, on: boolean) {
  productTagScenario.calls.push({
    rpc: admin ? (on ? "ProductSystemTagAdd" : "ProductSystemTagRemove") : on ? "ProductTagAdd" : "ProductTagRemove",
    productId,
    tagId,
  });

  const tag = tagById(tagId);
  if (!admin && tag.type !== ProductTagType.CUSTOM) {
    throw new ConnectError("a system tag is put on and taken off only by an admin", Code.PermissionDenied);
  }
  if (admin && tag.type !== ProductTagType.SYSTEM) {
    throw new ConnectError("a custom tag goes on and comes off as any tag does — this is for system tags", Code.InvalidArgument);
  }
  if (admin) refuseAppTag(tag);

  const key = productId.toString();
  const ids = carried.get(key) ?? [];
  if (on && !ids.includes(tagId)) carried.set(key, [...ids, tagId]);
  if (!on) carried.set(key, ids.filter((t) => t !== tagId));

  return { tags: tagsOnWire(productId) };
}
