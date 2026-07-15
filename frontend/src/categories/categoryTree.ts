import type { Category } from "../gen/warehouse/category/v1/category_pb";

// A category paired with how deep it sits in the tree — depth 0 is a top-level category. The UI
// renders this as an indented row / an indented select option, so it never has to recurse itself.
export interface CategoryNode {
  category: Category;
  depth: number;
}

// flattenTree turns the FLAT category list (each carrying its own parent_id, 0n = top-level) into a
// depth-annotated, display-ordered list: every category appears directly beneath its parent, and
// siblings are sorted by name (case-insensitive). Pure — no React, no I/O — so it is unit-testable.
//
// It is defensive about a malformed list: a cycle is broken (each id is emitted at most once) and an
// orphan (parent_id points at a category that is not in the list) is surfaced at the top level rather
// than silently dropped.
// childrenByParent groups categories under their parent_id (string key; "0" = top-level), each
// bucket sorted by name. The multistage picker reads one bucket per stage.
export function childrenByParent(categories: Category[]): Map<string, Category[]> {
  const map = new Map<string, Category[]>();

  for (const category of categories) {
    const key = category.parentId.toString();
    const bucket = map.get(key);

    if (bucket) {
      bucket.push(category);
    } else {
      map.set(key, [category]);
    }
  }

  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  return map;
}

// pathToRoot returns the ancestor chain [root … id] for a category id (inclusive), or [] for 0n /
// an unknown id. Cycle-safe. The multistage picker uses it to pre-fill each stage from a value.
export function pathToRoot(categories: Category[], id: bigint): Category[] {
  if (id === 0n) {
    return [];
  }

  const byId = new Map<string, Category>();
  for (const category of categories) {
    byId.set(category.id.toString(), category);
  }

  const path: Category[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id.toString());

  while (cur && !seen.has(cur.id.toString())) {
    seen.add(cur.id.toString());
    path.unshift(cur);
    cur = cur.parentId === 0n ? undefined : byId.get(cur.parentId.toString());
  }

  return path;
}

export function flattenTree(categories: Category[]): CategoryNode[] {
  // Group children under their parent_id (as a string key — bigint is not a stable Map key here).
  const childrenOf = new Map<string, Category[]>();

  for (const category of categories) {
    const key = category.parentId.toString();
    const bucket = childrenOf.get(key);

    if (bucket) {
      bucket.push(category);
    } else {
      childrenOf.set(key, [category]);
    }
  }

  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const out: CategoryNode[] = [];
  const emitted = new Set<string>();

  const walk = (parentKey: string, depth: number) => {
    const children = childrenOf.get(parentKey) ?? [];

    for (const category of children) {
      const id = category.id.toString();

      // Cycle guard: a category that was already placed is not descended into again.
      if (emitted.has(id)) {
        continue;
      }

      emitted.add(id);
      out.push({ category, depth });
      walk(id, depth + 1);
    }
  };

  walk("0", 0);

  // Orphans — parented to a category that is not present — get pulled up to the top level so the
  // owner can still see and re-parent them.
  const orphans = categories.filter((category) => !emitted.has(category.id.toString()));
  orphans.sort((a, b) => a.name.localeCompare(b.name));

  for (const category of orphans) {
    out.push({ category, depth: 0 });
  }

  return out;
}
