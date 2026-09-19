import { useQuery } from "@tanstack/react-query";
import { regionClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";

// The address picker's entry point: a KODE POS in, the desa it covers out — each with its full
// ancestry, so picking one fills all four levels (owner).
//
// This replaced a search over region NAMES. A postcode is the one part of an address a buyer quotes
// correctly: names are spelled three ways, hundreds of desa are called "Sukamaju", and the person
// typing the order has no way to tell the right one from the list. Five digits copied off a message
// have no such problem.
//
// GLOBAL reference data — no team in the key. Indonesia's regions are the same for everyone, which
// is why `key.regions` is one of the three non-scoped helpers in api/queryClient.ts.
//
// The cache earns more here than almost anywhere in the app: a postcode is typed digit by digit, so
// the same prefixes are asked for over and over — by one person correcting a typo, and by everyone
// entering an address in the same city.
export function useRegionByKodePos(args: { kodePos: string; limit: number; minChars: number }) {
  const { kodePos, limit, minChars } = args;

  return useQuery({
    queryKey: key.regions({ kodePos, limit }),
    ...referenceQuery,
    enabled: kodePos.length >= minChars,
    queryFn: async () => {
      const res = await regionClient.regionSearchByKodePos({ kodePos, limit });

      return res.results;
    },
  });
}
