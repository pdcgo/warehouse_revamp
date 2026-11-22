// THE ORDER TAGS as Storybook's stub plays them (backlog #100, live since the-order-tags-prototype-is-accepted) — the
// server's rules of proto/warehouse/selling/v1/order_tag.proto, kept beside the order rows of stubTransport.ts, whose
// OrderService answers the ten tag RPCs from here (its orderList / orderDetail carry `tags`, its list / stat / export
// filter `tag_ids`):
//
//   orders-have-their-own-tag-list (+ its 🔄 "A" lines)
//       the ORDERS' OWN list — the restocks' *Prioritas*, *Barang kurang* … are another list and never appear here; a
//       name unique trimmed, spaces folded, case ignored — creating one that exists answers THAT tag (created false),
//       never a twin; a CUSTOM tag by any team role that may write on the order; a SYSTEM tag, a rename, a delete and a
//       system tag put on / taken off only by Root / the Administrator (PermissionDenied); a rename onto another tag's
//       name is AlreadyExists; a delete takes the tag off every order and says how many. No app-owned order tags.
//   the-order-tags-prototype-is-accepted
//       the selling team and the warehouse shipping the order tag it, every role but a monitor, in EVERY status; any
//       other reader is NotFound (stubTransport's `onOrderSide`); the lists' filter `tag_ids` is ANY of.
//
// The seed — the prototype's, so the stories read as they were accepted:
//
//   id  name            type     who made it / where it is on
//   1   Audit Admin     SYSTEM   an admin (Root / Administrator) — on 103
//   11  VIP             CUSTOM   Toko Melati — on 101, 104
//   12  Kirim Pagi      CUSTOM   Toko Melati — on 101
//   13  Bonus Stiker    CUSTOM   Toko Kenanga — on 110 (another team's tag, still in Melati's list: one list, every team)
//   14  Kemasan Ulang   CUSTOM   Gudang Pusat (the warehouse tags too) — on 101, 105
//   15  Pre-order       CUSTOM   on nobody's order yet
//
// The fixture orders (fixtures.ts): Toko Melati (12) placed 101–109, Toko Kenanga (13) 110–111; Gudang Pusat (11) ships
// all but 107 and 109 (Gudang Cabang, 14).
//
// WRITEABLE, reset per story with the order notes (stubTransport `resetOrderNotes`, from preview's beforeEach).

import { Code, ConnectError } from "@connectrpc/connect";

import { cleanTagName, tagNameKey } from "../src/features/orders/tags/orderTags";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { OrderTagType } from "../src/gen/warehouse/selling/v1/order_tag_pb";
import { sessionScenario } from "./sessionScenario";

// The viewports the tag stories are judged at — the restock tags' (restockTagKit.ts).
export { DESKTOP, PHONE, TAG_VIEWPORTS } from "./restockTagKit";

export const TAG = {
  audit: 1n,
  vip: 11n,
  kirimPagi: 12n,
  bonusStiker: 13n,
  kemasanUlang: 14n,
  preOrder: 15n,
} as const;

/** The id the next tag made in a story takes — one past the list's last. */
export const NEXT_TAG_ID = 16n;

interface TagRow {
  id: bigint;
  name: string;
  type: OrderTagType;
}

const SEED: TagRow[] = [
  { id: TAG.audit, name: "Audit Admin", type: OrderTagType.SYSTEM },
  { id: TAG.vip, name: "VIP", type: OrderTagType.CUSTOM },
  { id: TAG.kirimPagi, name: "Kirim Pagi", type: OrderTagType.CUSTOM },
  { id: TAG.bonusStiker, name: "Bonus Stiker", type: OrderTagType.CUSTOM },
  { id: TAG.kemasanUlang, name: "Kemasan Ulang", type: OrderTagType.CUSTOM },
  { id: TAG.preOrder, name: "Pre-order", type: OrderTagType.CUSTOM },
];

const SEED_ON: Record<string, bigint[]> = {
  "101": [TAG.vip, TAG.kirimPagi, TAG.kemasanUlang],
  "103": [TAG.audit],
  "104": [TAG.vip],
  "105": [TAG.kemasanUlang],
  "110": [TAG.bonusStiker],
};

/** What the screens sent — every tag write, in order. Reset with the stub. */
export type OrderTagCall =
  | { rpc: "OrderTagCreate" | "OrderTagSystemCreate"; name: string }
  | { rpc: "OrderTagAdd" | "OrderSystemTagAdd"; orderId: bigint; tagId: bigint }
  | { rpc: "OrderTagRemove" | "OrderSystemTagRemove"; orderId: bigint; tagId: bigint }
  | { rpc: "OrderTagRename"; tagId: bigint; name: string }
  | { rpc: "OrderTagDelete"; tagId: bigint };

export const orderTagScenario = {
  calls: [] as OrderTagCall[],
  /** The Tag filter the last OrderStat was asked with (the seller's Statistik, the warehouse's tab counts). */
  statTagIds: undefined as bigint[] | undefined,
};

let tags: TagRow[] = [];
/** order id → the tags it carries. */
let carried = new Map<string, bigint[]>();
let nextId = NEXT_TAG_ID;

/** Back to the seed. */
export function resetOrderTagScenario() {
  tags = SEED.map((tag) => ({ ...tag }));
  carried = new Map(Object.entries(SEED_ON).map(([id, ids]) => [id, [...ids]]));
  nextId = NEXT_TAG_ID;
  orderTagScenario.calls = [];
  orderTagScenario.statTagIds = undefined;
}
resetOrderTagScenario();

// ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ordered = (list: TagRow[]) =>
  [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === OrderTagType.SYSTEM ? -1 : 1;
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : Number(a.id - b.id);
  });

const countOf = (tagId: bigint) => [...carried.values()].filter((ids) => ids.includes(tagId)).length;

function wire(tag: TagRow, withCount = false) {
  return { id: tag.id, name: tag.name, type: tag.type, orderCount: withCount ? BigInt(countOf(tag.id)) : 0n };
}

/** An order's tags as its reads carry them (`Order.tags`), the system's first, then by name. */
export function tagsOnWire(orderId: bigint) {
  const ids = carried.get(orderId.toString()) ?? [];
  return ordered(tags.filter((tag) => ids.includes(tag.id))).map((tag) => wire(tag));
}

/** The lists' filter: no pick is any tag; else the order carries ANY of them (scopedOrders' EXISTS). */
export function carriesAnyTag(orderId: bigint, tagIds: readonly bigint[] | undefined): boolean {
  if (!tagIds || tagIds.length === 0) return true;
  const ids = carried.get(orderId.toString()) ?? [];

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

export const listTags = (q: string, page: PageReq) => paged(q, page, false);
export const manageTags = (q: string, page: PageReq) => paged(q, page, true);

// ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const ADMINS: readonly Role[] = [Role.ROOT, Role.ADMINISTRATOR];
const TAGGERS: readonly Role[] = [
  ...ADMINS,
  Role.SELLING_OWNER,
  Role.SELLING_ADMIN,
  Role.SELLING_CS,
  Role.WAREHOUSE_OWNER,
  Role.WAREHOUSE_ADMIN,
  Role.WAREHOUSE_STAFF,
];

/** The proto's request policy: an admin RPC refuses everyone but Root / the Administrator; a team's, a monitor. */
export function refuseUnlessRole(admin: boolean) {
  const allowed = admin ? ADMINS : TAGGERS;
  if (!allowed.includes(sessionScenario.role)) throw new ConnectError("permission denied", Code.PermissionDenied);
}

function tagById(tagId: bigint): TagRow {
  const tag = tags.find((t) => t.id === tagId);
  if (!tag) throw new ConnectError("order tag not found", Code.NotFound);

  return tag;
}

/** Makes a tag — or answers the one that already carries the name, whatever its case (never a twin). */
export function createTag(name: string, type: OrderTagType) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  orderTagScenario.calls.push({ rpc: type === OrderTagType.SYSTEM ? "OrderTagSystemCreate" : "OrderTagCreate", name: clean });

  const held = tags.find((tag) => tagNameKey(tag.name) === tagNameKey(clean));
  if (held) return { tag: wire(held), created: false };

  const tag: TagRow = { id: nextId++, name: clean, type };
  tags.push(tag);

  return { tag: wire(tag), created: true };
}

export function renameTag(tagId: bigint, name: string) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  orderTagScenario.calls.push({ rpc: "OrderTagRename", tagId, name: clean });

  const tag = tagById(tagId);
  if (tags.some((other) => other.id !== tagId && tagNameKey(other.name) === tagNameKey(clean))) {
    throw new ConnectError("another order tag already carries this name", Code.AlreadyExists);
  }
  tag.name = clean;

  return { tag: wire(tag) };
}

export function deleteTag(tagId: bigint) {
  orderTagScenario.calls.push({ rpc: "OrderTagDelete", tagId });

  tagById(tagId);
  const orderCount = BigInt(countOf(tagId));
  tags = tags.filter((t) => t.id !== tagId);
  for (const [id, ids] of carried) carried.set(id, ids.filter((t) => t !== tagId));

  return { orderCount };
}

/**
 * Puts `tagId` on the order (on) or takes it off — the caller's side already checked (stubTransport `onOrderSide`).
 * `admin` is the admins' RPC (a system tag); otherwise the team's (a custom tag). Already on / not on is no change.
 */
export function setTag(orderId: bigint, tagId: bigint, admin: boolean, on: boolean) {
  orderTagScenario.calls.push({
    rpc: admin ? (on ? "OrderSystemTagAdd" : "OrderSystemTagRemove") : on ? "OrderTagAdd" : "OrderTagRemove",
    orderId,
    tagId,
  });

  const tag = tagById(tagId);
  if (!admin && tag.type !== OrderTagType.CUSTOM) {
    throw new ConnectError("a system tag is put on and taken off only by an admin", Code.PermissionDenied);
  }
  if (admin && tag.type !== OrderTagType.SYSTEM) {
    throw new ConnectError("a custom tag goes on and comes off as any tag does — this is for system tags", Code.InvalidArgument);
  }

  const key = orderId.toString();
  const ids = carried.get(key) ?? [];
  if (on && !ids.includes(tagId)) carried.set(key, [...ids, tagId]);
  if (!on) carried.set(key, ids.filter((t) => t !== tagId));

  return { tags: tagsOnWire(orderId) };
}
