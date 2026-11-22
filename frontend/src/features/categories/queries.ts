import { useQuery } from "@tanstack/react-query";
import { categoryClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";

// THE CATEGORY TREE — one read, two kinds of caller (#121).
//
// GLOBAL reference data — no team in the key. The taxonomy is the same for everyone, which is why `key.categories` is
// one of the non-scoped helpers in api/queryClient.ts. The whole tree in one call: a picker needs every node to
// assemble its columns (HARD RULE 9's tree exception — a documented PICKER FEED).
//
// ONE ENTRY for both callers. The category page browses it (`useCategories`, pages/categories/queries.ts — always fresh,
// the screen root works from) and every CategorySelect labels a field from it (`useCategoryOptions` below). Sharing
// the key is what lets the page's own Create/Move dialogs open their picker with no second CategoryList, and a category
// write's invalidation of `categories` refresh both at once.
export function categoryTreeQuery() {
  return {
    queryKey: key.categories(),
    queryFn: async () => {
      const res = await categoryClient.categoryList({});

      return res.categories;
    },
  };
}

// The PICKER FEED — CategorySelect's options. `referenceQuery` (HARD RULE 10's one buy-out, by name): a category labels
// a product, nobody works from it, and the picker is on several forms at once. A category added or renamed on the
// category page invalidates the `categories` prefix, so an open picker shows it straight away.
export function useCategoryOptions() {
  return useQuery({ ...categoryTreeQuery(), ...referenceQuery });
}
