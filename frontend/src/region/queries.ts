import { useQuery } from "@tanstack/react-query";
import { regionClient } from "../api/clients";
import { key } from "../api/queryClient";

// Region search, for the address picker (#176/#177's component sweep).
//
// GLOBAL reference data — no team in the key. Indonesia's regions are the same for everyone, which
// is why `key.regions` is one of the three non-scoped helpers in api/queryClient.ts.
//
// The cache earns more here than anywhere else in the app. This is a four-level cascade somebody
// types their way down, so the same prefixes are searched over and over — by the same person
// correcting a typo, and by every other person entering an address in the same city. A hand-rolled
// search asked the server every single time.
export function useRegionSearch(args: { q: string; limit: number; minChars: number }) {
  const { q, limit, minChars } = args;

  return useQuery({
    queryKey: key.regions({ search: q, limit }),
    enabled: q.length >= minChars,
    queryFn: async () => {
      const res = await regionClient.regionSearch({ q, limit });

      return res.results;
    },
  });
}
