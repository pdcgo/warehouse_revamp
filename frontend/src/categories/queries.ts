import { useQuery, useQueryClient } from "@tanstack/react-query";
import { categoryClient } from "../api/clients";
import { key } from "../api/queryClient";

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
