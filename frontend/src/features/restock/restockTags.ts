// A RESTOCK'S TAGS — what a tag is, and the few rules every screen reads the same way (backlog #87, LIVE since the
// accept, the-restock-tags-prototype-is-accepted).
//
// The owner's decisions (docs/business/inventory/restock_decision.md):
//   · a-restock-tag-is-system-or-custom — a restock carries tags and the restock list filters by tag; a tag is `system`
//     (owned by the system) or `custom` (created freely by a user);
//   · custom-tags-are-shared-system-tags-are-the-admins-and-the-apps — a tag's name is unique app-wide (ONE list for
//     every team); a custom tag once made is usable by every team; a restock's tags are seen and filtered on the
//     seller's AND the warehouse's lists; a system tag is made / put on / taken off only by admins (Root / Administrator)
//     and the app's own tasks; only admins RENAME or DELETE a tag (its 🔄 line);
//   · a-restock-problem-is-a-system-tag (+ "A") — Terima puts *Barang kurang* / *Barang rusak* on;
//   · the-restock-tags-prototype-is-accepted — the Tag filter takes SEVERAL tags, a restock shown when it carries ANY;
//     a tag goes on and comes off in EVERY status, and the seller's Tag column is always drawn (the owner's 🔄 lines).
//
// THE API (proto/warehouse/inventory/v1/restock_tag.proto, on RestockRequestService):
//   RestockTagList            the app-wide list, every team's (a read; the filter and the add box)
//   RestockTagManageList      the admins' list, each tag's restock count (Kelola tag)
//   RestockTagCreate          a CUSTOM tag; a name that exists, any case, answers THAT tag — never a twin
//   RestockTagSystemCreate    a SYSTEM tag, Root / Administrator only
//   RestockTagRename / Delete Root / Administrator only; delete takes it off every restock
//   RestockRequestTagAdd / Remove              a custom tag on / off — either side, every role but a monitor
//   RestockRequestSystemTagAdd / Remove        an admin's system tag on / off — Root / Administrator only
//   RestockRequest.tags                        a restock's tags, on the list's rows and the detail
//   RestockRequestListFilter.tag_ids           ANY of — inside restockListScope, so the rows, the statistics and
//                                              Ekspor narrow alike
// The app's own tags (`app_task` set) are locked for everyone — never put on or taken off by hand, never renamed or
// deleted; the server refuses it too.

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { RestockTag as WireTag } from "../../gen/warehouse/inventory/v1/restock_tag_pb";
import { RestockTagType as WireTagType } from "../../gen/warehouse/inventory/v1/restock_tag_pb";
import { idCodec, listCodec } from "../../lib/urlState";
import { brokenQuantity } from "./summary";

export type RestockTagType = "SYSTEM" | "CUSTOM";

export interface RestockTag {
  id: bigint;
  name: string;
  type: RestockTagType;
  /** The app's own task that owns this SYSTEM tag — the problem tags' Terima; absent for a tag an admin made. */
  appTask?: string;
}

/** A tag as the wire carries it, in the screens' words. */
export function tagFromWire(tag: WireTag): RestockTag {
  return {
    id: tag.id,
    name: tag.name,
    type: tag.type === WireTagType.SYSTEM ? "SYSTEM" : "CUSTOM",
    appTask: tag.appTask === "" ? undefined : tag.appTask,
  };
}

/** The lists' Tag filter in the address — the picked ids, comma-joined (`?tag=1,2`); none picked is left out. */
export const TAGS_CODEC = listCodec(idCodec);
/** No tag picked — "any tag". One array, so the filter's default is the same value every render. */
export const NO_TAGS: bigint[] = [];

/** A restock's tags in every screen's order — the system's first, then by name. */
export function tagsOfRequest(request: Pick<RestockRequest, "tags">): RestockTag[] {
  return sortTags(request.tags.map(tagFromWire));
}

/**
 * A tag the APP puts on and takes off (a problem tag): nobody does either by hand, an admin included, and it is not
 * renamed or deleted — WHEN a problem tag comes off waits on the problem's solution (a-restock-problem-is-a-system-tag:
 * not decided), so nothing here draws it coming off.
 */
export function isAppTag(tag: RestockTag): boolean {
  return tag.type === "SYSTEM" && (tag.appTask ?? "") !== "";
}

/** What two names are compared by — trimmed, inner spaces folded to one, case ignored: "  lebaran  2026" is "Lebaran 2026". */
export function tagNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name as it is kept — trimmed, inner spaces folded to one; the case as typed. */
export function cleanTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The tag of the app-wide list that already carries this name, whatever its case — undefined when none does. */
export function tagNamed(catalogue: RestockTag[], name: string): RestockTag | undefined {
  const key = tagNameKey(name);
  if (key === "") return undefined;

  return catalogue.find((tag) => tagNameKey(tag.name) === key);
}

/** A restock's tags in the order every screen draws them — the system's first, then by name. */
export function sortTags(tags: RestockTag[]): RestockTag[] {
  return [...tags].sort((a, b) => {
    if (a.type !== b.type) return a.type === "SYSTEM" ? -1 : 1;
    return a.name.localeCompare(b.name, "id", { sensitivity: "base" });
  });
}

// A RESTOCK'S PROBLEM IS A SYSTEM TAG, NOT A STATUS (the owner, 2026-11-18 — a-restock-problem-is-a-system-tag, then "A":
// two tags, one per kind): when Terima records MISSING units the app puts *Barang kurang* on, BROKEN units *Barang
// rusak*; a restock with both kinds carries both, and stays Diterima. A team's user sees and filters by them and cannot
// put them on or take them off. When they come off is not decided (the problem's solution — the owner is writing it).
export const PROBLEM_TAG_NAMES = { missing: "Barang kurang", broken: "Barang rusak" } as const;
export const PROBLEM_TAG_TASKS = { missing: "restock.problem.missing", broken: "restock.problem.broken" } as const;

/** How many units came BROKEN across every line — the problem list's second count beside *kurang N*. 0 until accepted. */
export function brokenTotal(request: RestockRequest): bigint {
  if (request.status !== RestockRequestStatus.ACCEPTED) return 0n;

  return request.items.reduce((sum, item) => sum + brokenQuantity(item), 0n);
}
