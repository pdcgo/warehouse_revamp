// THE RESTOCK TAGS as Storybook's stub plays them (backlog #87, live since the-restock-tags-prototype-is-accepted) — the
// server's rules of proto/warehouse/inventory/v1/restock_tag.proto, kept beside the restock rows of restockStub.ts,
// whose RestockRequestService answers the ten tag RPCs from here:
//
//   custom-tags-are-shared-system-tags-are-the-admins-and-the-apps
//       ONE app-wide list; a name unique trimmed, spaces folded, case ignored — creating one that exists answers THAT tag
//       (created false), never a twin; a CUSTOM tag by any team role that may tag; a SYSTEM tag, a rename, a delete and
//       a system tag put on / taken off only by Root / the Administrator (PermissionDenied); a rename onto another
//       tag's name is AlreadyExists; a delete takes the tag off every restock and says how many.
//   a-restock-problem-is-a-system-tag (+ "A")
//       *Barang kurang* / *Barang rusak* are the app's (`app_task`): Terima puts them on (putProblemTags, from the
//       accept), and nobody moves, renames or deletes them by hand (FailedPrecondition) — the reset reads them off every
//       accepted restock's problem rows, as the migration's data step does.
//   the-restock-tags-prototype-is-accepted
//       either side of a restock tags it, every role but a monitor, in EVERY status; the list filter `tag_ids` is ANY of.
//
// The seed — the prototype's, so the stories read as they were accepted:
//
//   id  name               type     on
//   1   Barang kurang      SYSTEM   the app, at Terima, on a restock with missing units
//   2   Barang rusak       SYSTEM   the app, at Terima, on a restock with broken units
//   3   Audit Gudang       SYSTEM   an admin made it — on 501
//   11  Prioritas          CUSTOM   Toko Melati — on 501, 502
//   12  Lebaran 2026       CUSTOM   Toko Melati — on 501
//   13  Barang Promo       CUSTOM   Toko Kenanga — on 506 (another team's, still in Melati's list: one list, every team)
//   14  Retur ke Supplier  CUSTOM   Gudang Pusat — on 503 (the warehouse tags too)
//   15  Supplier Baru      CUSTOM   nobody's restock yet
//
// WRITEABLE, reset with the restock stub (resetRestockStub → resetRestockTagScenario).

import { Code, ConnectError } from "@connectrpc/connect";

import { RestockProblemType, RestockRequestStatus as S } from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { RestockTagType } from "../src/gen/warehouse/inventory/v1/restock_tag_pb";
import { PROBLEM_TAG_NAMES, PROBLEM_TAG_TASKS, cleanTagName, tagNameKey } from "../src/features/restock/restockTags";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import type { RestockFixture } from "./restockFixtures";
import { sessionScenario } from "./sessionScenario";

export const TAG = {
  missing: 1n,
  broken: 2n,
  audit: 3n,
  prioritas: 11n,
  lebaran: 12n,
  promo: 13n,
  retur: 14n,
  supplierBaru: 15n,
} as const;

interface TagRow {
  id: bigint;
  name: string;
  type: RestockTagType;
  appTask: string;
}

const SEED: TagRow[] = [
  { id: TAG.missing, name: PROBLEM_TAG_NAMES.missing, type: RestockTagType.SYSTEM, appTask: PROBLEM_TAG_TASKS.missing },
  { id: TAG.broken, name: PROBLEM_TAG_NAMES.broken, type: RestockTagType.SYSTEM, appTask: PROBLEM_TAG_TASKS.broken },
  { id: TAG.audit, name: "Audit Gudang", type: RestockTagType.SYSTEM, appTask: "" },
  { id: TAG.prioritas, name: "Prioritas", type: RestockTagType.CUSTOM, appTask: "" },
  { id: TAG.lebaran, name: "Lebaran 2026", type: RestockTagType.CUSTOM, appTask: "" },
  { id: TAG.promo, name: "Barang Promo", type: RestockTagType.CUSTOM, appTask: "" },
  { id: TAG.retur, name: "Retur ke Supplier", type: RestockTagType.CUSTOM, appTask: "" },
  { id: TAG.supplierBaru, name: "Supplier Baru", type: RestockTagType.CUSTOM, appTask: "" },
];

const SEED_ON: Record<string, bigint[]> = {
  "501": [TAG.audit, TAG.prioritas, TAG.lebaran],
  "502": [TAG.prioritas],
  "503": [TAG.retur],
  "506": [TAG.promo],
};

/** What the screens sent — every tag write, in order. Reset with the stub. */
export type RestockTagCall =
  | { rpc: "RestockTagCreate" | "RestockTagSystemCreate"; name: string }
  | { rpc: "RestockRequestTagAdd" | "RestockRequestTagRemove"; teamId: bigint; requestId: bigint; tagId: bigint }
  | { rpc: "RestockRequestSystemTagAdd" | "RestockRequestSystemTagRemove"; teamId: bigint; requestId: bigint; tagId: bigint }
  | { rpc: "RestockTagRename"; tagId: bigint; name: string }
  | { rpc: "RestockTagDelete"; tagId: bigint };

export const restockTagScenario = { calls: [] as RestockTagCall[] };

let tags: TagRow[] = [];
/** restock id → the tags it carries. */
let carried = new Map<string, bigint[]>();
let nextId = 16n;

const problemKinds = (r: RestockFixture) =>
  new Set(r.items.flatMap((line) => line.problems.filter((p) => p.count > 0n).map((p) => p.type)));

/** Back to the seed — the problem tags read off every accepted restock's problem rows (the migration's data step). */
export function resetRestockTagScenario(rows: RestockFixture[]) {
  tags = SEED.map((tag) => ({ ...tag }));
  carried = new Map();
  nextId = 16n;
  restockTagScenario.calls = [];

  for (const r of rows) {
    const ids: bigint[] = [];
    if (r.status === S.ACCEPTED) {
      const kinds = problemKinds(r);
      if (kinds.has(RestockProblemType.MISSING)) ids.push(TAG.missing);
      if (kinds.has(RestockProblemType.BROKEN)) ids.push(TAG.broken);
    }
    ids.push(...(SEED_ON[r.id.toString()] ?? []));
    if (ids.length > 0) carried.set(r.id.toString(), ids);
  }
}

// ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ordered = (list: TagRow[]) =>
  [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === RestockTagType.SYSTEM ? -1 : 1;
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : Number(a.id - b.id);
  });

const countOf = (tagId: bigint) => [...carried.values()].filter((ids) => ids.includes(tagId)).length;

function wire(tag: TagRow, withCount = false) {
  return {
    id: tag.id,
    name: tag.name,
    type: tag.type,
    appTask: tag.appTask,
    restockCount: withCount ? BigInt(countOf(tag.id)) : 0n,
  };
}

/** A restock's tags as its reads carry them (`RestockRequest.tags`), the system's first, then by name. */
export function tagsOnWire(restockId: bigint) {
  const ids = carried.get(restockId.toString()) ?? [];
  return ordered(tags.filter((tag) => ids.includes(tag.id))).map((tag) => wire(tag));
}

/** The list's filter: no pick is any tag; else the restock carries ANY of them. */
export function carriesAnyTag(restockId: bigint, tagIds: readonly bigint[] | undefined): boolean {
  if (!tagIds || tagIds.length === 0) return true;
  const ids = carried.get(restockId.toString()) ?? [];

  return tagIds.some((id) => ids.includes(id));
}

type PageReq = { page?: number; limit?: number } | undefined;

function paged(list: TagRow[], q: string, page: PageReq, withCount: boolean) {
  const needle = q.trim().toLowerCase();
  const all = ordered(list).filter((tag) => needle === "" || tag.name.toLowerCase().includes(needle));
  const limit = page?.limit || 20;
  const current = page?.page || 1;

  return {
    tags: all.slice((current - 1) * limit, current * limit).map((tag) => wire(tag, withCount)),
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(all.length / limit)), totalItems: BigInt(all.length) },
  };
}

export const listTags = (q: string, page: PageReq) => paged(tags, q, page, false);
export const manageTags = (q: string, page: PageReq) => paged(tags, q, page, true);

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

const missing = () => new ConnectError("tag not found", Code.NotFound);
const appOwned = () =>
  new ConnectError(
    "the app puts this tag on — nobody puts it on, takes it off, renames or deletes it by hand",
    Code.FailedPrecondition,
  );

function tagById(tagId: bigint): TagRow {
  const tag = tags.find((t) => t.id === tagId);
  if (!tag) throw missing();

  return tag;
}

/** Makes a tag — or answers the one that already carries the name, whatever its case (never a twin). */
export function createTag(name: string, type: RestockTagType) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  restockTagScenario.calls.push({
    rpc: type === RestockTagType.SYSTEM ? "RestockTagSystemCreate" : "RestockTagCreate",
    name: clean,
  });

  const held = tags.find((tag) => tagNameKey(tag.name) === tagNameKey(clean));
  if (held) return { tag: wire(held), created: false };

  const tag: TagRow = { id: nextId++, name: clean, type, appTask: "" };
  tags.push(tag);

  return { tag: wire(tag), created: true };
}

export function renameTag(tagId: bigint, name: string) {
  const clean = cleanTagName(name);
  if (clean === "") throw new ConnectError("a tag needs a name", Code.InvalidArgument);

  restockTagScenario.calls.push({ rpc: "RestockTagRename", tagId, name: clean });

  const tag = tagById(tagId);
  if (tag.appTask !== "") throw appOwned();
  if (tags.some((other) => other.id !== tagId && tagNameKey(other.name) === tagNameKey(clean))) {
    throw new ConnectError("another tag already carries this name", Code.AlreadyExists);
  }
  tag.name = clean;

  return { tag: wire(tag) };
}

export function deleteTag(tagId: bigint) {
  restockTagScenario.calls.push({ rpc: "RestockTagDelete", tagId });

  const tag = tagById(tagId);
  if (tag.appTask !== "") throw appOwned();

  const restockCount = BigInt(countOf(tagId));
  tags = tags.filter((t) => t.id !== tagId);
  for (const [id, ids] of carried) carried.set(id, ids.filter((t) => t !== tagId));

  return { restockCount };
}

/**
 * Puts `tagId` on the restock (on) or takes it off — the caller's side already checked. `admin` is the admins' RPC (a
 * system tag that is not the app's); otherwise the team's (a custom tag). Already on / not on is no change.
 */
export function setTag(teamId: bigint, restockId: bigint, tagId: bigint, admin: boolean, on: boolean) {
  restockTagScenario.calls.push({
    rpc: admin
      ? on
        ? "RestockRequestSystemTagAdd"
        : "RestockRequestSystemTagRemove"
      : on
        ? "RestockRequestTagAdd"
        : "RestockRequestTagRemove",
    teamId,
    requestId: restockId,
    tagId,
  });

  const tag = tagById(tagId);
  if (!admin && tag.type !== RestockTagType.CUSTOM) {
    throw new ConnectError("a system tag is put on and taken off only by an admin", Code.PermissionDenied);
  }
  if (admin && tag.appTask !== "") throw appOwned();
  if (admin && tag.type !== RestockTagType.SYSTEM) {
    throw new ConnectError("a custom tag goes on and comes off as any tag does — this is for system tags", Code.InvalidArgument);
  }

  const key = restockId.toString();
  const ids = carried.get(key) ?? [];
  if (on && !ids.includes(tagId)) carried.set(key, [...ids, tagId]);
  if (!on) carried.set(key, ids.filter((t) => t !== tagId));

  return { tags: tagsOnWire(restockId) };
}

/** Terima: the app puts *Barang kurang* on for missing units, *Barang rusak* for broken ones (a-restock-problem-is-a-system-tag). */
export function putProblemTags(restockId: bigint, missingUnits: boolean, brokenUnits: boolean) {
  const key = restockId.toString();
  const ids = [...(carried.get(key) ?? [])];
  if (missingUnits && !ids.includes(TAG.missing)) ids.push(TAG.missing);
  if (brokenUnits && !ids.includes(TAG.broken)) ids.push(TAG.broken);
  carried.set(key, ids);
}

/**
 * Backlog #101 — the seller marked the restock SETTLED: the app takes *Barang kurang* / *Barang rusak* off
 * (a-restock-problem-is-settled-by-resolution-rows, 🔄 B). Called by the stub's RestockRequestSettle (restockStub.ts) and
 * by the story kit for a seed's settled restock; nothing else takes an app tag off.
 */
export function takeProblemTagsOff(restockId: bigint) {
  const key = restockId.toString();
  carried.set(key, (carried.get(key) ?? []).filter((id) => id !== TAG.missing && id !== TAG.broken));
}
