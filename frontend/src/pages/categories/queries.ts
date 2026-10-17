import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { categoryClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The category screen's reads (#176).
//
// GLOBAL reference data — no team in the key. The taxonomy is the same for everyone, which is why
// `key.categories` is one of the three non-scoped helpers in api/queryClient.ts. Putting a team in
// this key would give every team its own copy of an identical tree.
export function useCategories() {
  return useQuery({
    queryKey: key.categories(),
    queryFn: async () => {
      const res = await categoryClient.categoryList({});

      return res.categories;
    },
  });
}

export function useInvalidateCategories() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["categories"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// The write declares what it invalidates; see src/expenses/queries.ts for why that beats an `onDone`
// callback the parent had to remember to wire.
//
// ONLY `categories` is invalidated, and that is worth stating because a category change looks like it
// should touch products. It does not: a product stores `category_id` alone (no denormalised name), so
// a rename cannot stale a product row — the name a product screen shows is read from THIS query, and
// invalidating it is what refreshes them both.

interface SaveCategoryVars {
  /** Set to rename or move an existing node; omitted to add one. */
  categoryId?: bigint;
  /** Absent on an edit = leave the name alone (a Move). Required to add one. */
  name?: string;
  /** Absent on an edit = leave the parent alone (a Rename); 0n = top-level. */
  parentId?: bigint;
}

// Rename and Move are TWO edits of one RPC — CategoryUpdate's fields are optional, so each sends only its own and the
// other is left as it is on the server, not overwritten with what a form happened to hold.
export function useSaveCategory() {
  const invalidate = useInvalidateCategories();

  return useMutation({
    mutationFn: async ({ categoryId, name, parentId }: SaveCategoryVars) =>
      categoryId === undefined
        ? await categoryClient.categoryCreate({ name: name ?? "", parentId: parentId ?? 0n })
        : await categoryClient.categoryUpdate({ categoryId, name, parentId }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories();

  return useMutation({
    mutationFn: (vars: { categoryId: bigint }) => categoryClient.categoryDelete(vars),
    onSuccess: () => invalidate(),
  });
}
