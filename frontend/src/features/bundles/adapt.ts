import {
  BundleByIdsDataType,
  type BundleByIdsResponse,
  BundleListDataType,
  type BundleListResponseItem,
  type BundleRowItem,
} from "../../gen/warehouse/product/v1/bundle_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";

// The bundle domain's proto → record mapper (docs/business/product/product_bundle.md). Pages read `BundleRecord` and
// never walk a guideline envelope's oneof.

/** One product of a bundle, and how many go into ONE bundle (a-bundle-line-carries-its-quantity). */
export interface BundleLineRecord {
  productId: bigint;
  quantity: number;
}

/** A bundle as the screens see it — a picking recipe, with no stock and no price. */
export interface BundleRecord {
  id: bigint;
  /** Always a selling team. */
  teamId: bigint;
  name: string;
  description: string;
  /** Who made it — the one CS who may change it besides an Admin (the-creator-or-an-admin-edits-a-bundle). */
  createdByUserId: bigint;
  createdAtUnix: bigint;
  updatedAtUnix: bigint;
  lines: BundleLineRecord[];
}

export const bundleListRowData = (): BundleListDataType[] => [BundleListDataType.BUNDLE];
export const bundleByIdsRowData = (): BundleByIdsDataType[] => [BundleByIdsDataType.BUNDLE];

/** One row — what a create or an update answers with. */
export function bundleRecord(r: BundleRowItem): BundleRecord {
  return {
    id: r.id,
    teamId: r.teamId,
    name: r.name,
    description: r.description,
    createdByUserId: r.createdByUserId,
    createdAtUnix: r.createdAtUnix,
    updatedAtUnix: r.updatedAtUnix,
    lines: r.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
  };
}

/** A list response, in the server's sorted order. */
export function bundlesFromList(items: BundleListResponseItem[], ids: bigint[]): BundleRecord[] {
  const rows = new Map<string, BundleRowItem>();

  for (const it of items) {
    if (it.d.case === "bundle") {
      for (const [id, row] of Object.entries(it.d.value.mapData)) {
        rows.set(id, row);
      }
    }
  }

  return ids.flatMap((id) => {
    const row = rows.get(id.toString());
    return row ? [bundleRecord(row)] : [];
  });
}

/** A by-ids response, keyed by bundle id. An id the team does not hold is simply absent. */
export function bundlesFromByIds(res: BundleByIdsResponse): Map<string, BundleRecord> {
  const out = new Map<string, BundleRecord>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "bundle") {
        const row = it.d.value.mapData[id];
        if (row) out.set(id, bundleRecord(row));
      }
    }
  }

  return out;
}

// ── What a line's product means to THIS bundle ───────────────────────────────────────────────────
//
// A line carries only the product id (a-bundle-line-reads-its-owner-from-the-product), so whether it is the team's own,
// borrowed, or no longer usable is read off the product — the row ProductByIds serves, which keeps answering for an
// archived product.
//
//   own       the bundle's team owns it
//   borrowed  another team's, still shareable
//   locked    another team's, and its owner has since locked it — the line stays, an order fills its slot with
//             something else (a-borrowed-product-never-blocks-its-owner). The OWNER's own lock never applies: a lock
//             only stops other teams.
//   archived  the product was deleted — by its owner, whoever that is. Its name still shows, as *(archived)*.
//   unknown   not resolved (yet, or the lookup failed) — never shown as a problem the bundle has.
export type LineState = "own" | "borrowed" | "locked" | "archived" | "unknown";

export function lineState(product: Product | undefined, bundleTeamId: bigint): LineState {
  if (!product) return "unknown";
  if (product.deleted) return "archived";
  if (product.teamId === bundleTeamId) return "own";

  return product.crossLocked ? "locked" : "borrowed";
}

/** Locked or archived: an order cannot use it as it stands. */
export const unavailable = (state: LineState) => state === "locked" || state === "archived";
