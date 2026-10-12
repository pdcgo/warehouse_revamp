import { useQuery } from "@tanstack/react-query";
import { regionClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";
import type { Region, RegionLevel } from "../../gen/warehouse/region/v1/region_pb";

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
// THE OTHER WAY IN: a region's NAME, narrowed to one level (owner).
//
// The postcode is the fast path and stays the default, but it is not the only thing a buyer's message
// carries — plenty give a kecamatan and no code at all, and until now that person had to walk the
// cascade from the province down. `RegionSearch` already takes a `level`, so "find the kecamatan
// called X" is one call, and its hit carries the full ancestry above it.
//
// ⚠ A KECAMATAN HIT HAS NO KODE POS, and that is the dataset, not a gap here: the code belongs to a
// desa. A caller that wants one derives it from the kecamatan's children — see AddressPicker.
export function useRegionSearch(args: {
  q: string;
  level: RegionLevel;
  limit: number;
  minChars: number;
}) {
  const { q, level, limit, minChars } = args;

  return useQuery({
    queryKey: key.regions({ q, level, limit }),
    ...referenceQuery,
    enabled: q.length >= minChars,
    queryFn: async () => {
      const res = await regionClient.regionSearch({ q, level, limit });

      return res.results;
    },
  });
}

// THE DESA UNDER SEVERAL KECAMATAN AT ONCE — what the kecamatan search shows beneath each hit.
//
// A kecamatan holds many desa and each carries its own kode pos, so listing them under the hit is
// what turns "I know the district" into a complete address in ONE pick (owner).
//
// ⚠ ONE CACHE ENTRY FOR THE WHOLE SET, not one per kecamatan. The calls go out together and are held
// together, so a typeahead that lands on the same four hits twice makes no second round of requests —
// and `referenceQuery` is right here for the same reason it is right for the postcode search: region
// data is read to LABEL something and is the same for everyone.
export function useDesaOfKecamatans(args: { codes: string[]; limit: number }) {
  // Sorted and de-duplicated so the key is stable: the same four kecamatan in a different order are
  // the same question.
  const codes = [...new Set(args.codes.filter(Boolean))].sort();

  return useQuery({
    queryKey: key.regions({ desaOf: codes.join(","), limit: args.limit }),
    ...referenceQuery,
    enabled: codes.length > 0,
    queryFn: async () => {
      const lists = await Promise.all(
        codes.map((parentCode) =>
          regionClient.regionList({ parentCode, page: { page: 1, limit: args.limit } }),
        ),
      );

      const byKecamatan = new Map<string, Region[]>();
      codes.forEach((code, i) => byKecamatan.set(code, lists[i]!.regions));

      return byKecamatan;
    },
  });
}

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
