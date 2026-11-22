import type { Category } from "../../gen/warehouse/category/v1/category_pb";

// THE KATEGORI PAGE'S PRODUK COLUMN — real since backlog #115 (the-product-count-is-a-marked-sample, ✅ 2026-11-21).
// The server counts what is filed DIRECTLY on each category (ProductCategoryCounts: every team's live products, a product
// having one category — a-product-has-one-category); what a BRANCH reads is the screen's, made here from those figures
// and the tree the page already holds (CategoryList).

/** A category's products: filed on the node itself, and on it plus every node below it. */
export interface CategoryProducts {
  own: number;
  branch: number;
}

/**
 * Every node's own and whole-branch figures, from the served own counts (keyed by category id) and the tree. A node the
 * server did not list holds none of its own; a count for an id the tree does not hold (a deleted category) has no row to
 * land on and is not added anywhere.
 */
export function categoryProducts(
  categories: readonly Category[],
  own: ReadonlyMap<string, number>,
): Map<string, CategoryProducts> {
  const children = new Map<string, string[]>();
  for (const c of categories) {
    const parent = c.parentId.toString();
    children.set(parent, [...(children.get(parent) ?? []), c.id.toString()]);
  }

  const out = new Map<string, CategoryProducts>();
  const visiting = new Set<string>();

  // Depth-first, each node once; a parent loop (which the server never builds) stops at the node seen twice.
  const branchOf = (id: string): number => {
    const done = out.get(id);
    if (done) return done.branch;
    if (visiting.has(id)) return 0;

    visiting.add(id);
    const mine = own.get(id) ?? 0;
    const below = (children.get(id) ?? []).reduce((sum, child) => sum + branchOf(child), 0);
    out.set(id, { own: mine, branch: mine + below });

    return mine + below;
  };

  for (const c of categories) branchOf(c.id.toString());

  return out;
}

/**
 * HELD — the owner's Q3: does a branch's *Produk* read its OWN products or its WHOLE BRANCH? Drawn as **A** until he
 * answers; B and C exist only for the mock stories (`branchCountMock.tsx`), so he can see all three on one tree.
 *
 *   A  the whole branch — the set Discover's Kategori keeps (a-picked-branch-keeps-its-whole-subtree): Makanan 120
 *   B  only what is filed on the node itself — a node holding none reads —
 *   C  both: its own, then the whole branch's total — *8 · 120 total*
 *
 * THE ONE PLACE THE CHOICE IS MADE — the page draws whatever this answers: `figure` (null = —) and, for C, `total`.
 */
export type BranchCountOption = "A" | "B" | "C";

export interface ShownProductCount {
  figure: number | null;
  total?: number;
}

export function productCountShown(products: CategoryProducts, option: BranchCountOption = "A"): ShownProductCount {
  if (option === "B") return { figure: products.own > 0 ? products.own : null };
  if (option === "C") return { figure: products.own > 0 ? products.own : null, total: products.branch };

  return { figure: products.branch };
}
