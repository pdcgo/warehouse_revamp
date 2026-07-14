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
