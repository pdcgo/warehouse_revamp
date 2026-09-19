import { useQuery } from "@tanstack/react-query";
import { rackClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { racksFromList, rackListRowData } from "./adapt";

// A warehouse's rack id → CODE map.
//
// Stock records WHERE it went as a rack id, and an id is unreadable: "A-01-3" is painted on the
// aisle, "7" is not. Any screen that shows a stored placement therefore needs the whole shelf list
// to translate it, which is one read rather than one per line.
//
// It lives in features/ rather than beside the racks pages because the callers are NOT rack screens:
// the restock detail resolves a delivery's put-away with it. One large page covers a warehouse's
// shelves; a warehouse with more than this many needs a different screen, not a bigger page.
const RACK_LOOKUP_SIZE = 200;

// The ONE read behind both hooks below, so a screen that shows a placement AND lets you change it
// (the accept page, the warehouse product page) fetches a warehouse's shelves once, not twice. They
// differ only in `select`, which react-query applies per-hook over a single shared cache entry.
function rackListOptions(warehouseId: bigint, enabled: boolean) {
  return {
    queryKey: key.racks(warehouseId, { lookup: true }),
    enabled: enabled && warehouseId > 0n,
    queryFn: async () => {
      // RackList scopes racks by `team_id` — a warehouse IS a team (one of type WAREHOUSE), and the
      // handler matches it against the rack's `warehouse_id`. Deleted racks are filtered server-side,
      // and the list comes back ordered by code, which is how someone walking the aisles reads it.
      const res = await rackClient.rackList({
        teamId: warehouseId,
        dataRequest: rackListRowData(),
        page: { page: 1, limit: RACK_LOOKUP_SIZE },
      });

      return racksFromList(res.items, res.ids);
    },
  };
}

// A warehouse's racks, in aisle order — what a PICKER needs (code AND name).
//
// Through react-query rather than a hand-rolled effect, and that is the point of the hook rather
// than a nicety: the effect version fetched once keyed on `warehouseId` and, on failure, set an
// error and stopped. The effect could not re-run because the warehouse had not changed, so one
// transient failure left the picker permanently empty — "Racks unavailable" with no way back but a
// reload. ShopSelect hit exactly this (#176) and this is the same fix.
export function useRacks(args: { warehouseId: bigint; enabled?: boolean }) {
  const { warehouseId, enabled = true } = args;

  return useQuery(rackListOptions(warehouseId, enabled));
}

export function useRackCodes(args: { warehouseId: bigint; enabled?: boolean }) {
  const { warehouseId, enabled = true } = args;

  return useQuery({
    ...rackListOptions(warehouseId, enabled),
    // Stock records WHERE it went as a rack id, and an id is unreadable: "A-01-3" is painted on the
    // aisle, "7" is not. Any screen that shows a stored placement needs the whole shelf list to
    // translate it, which is one read rather than one per line.
    select: (racks) => {
      const codes: Record<string, string> = {};
      for (const rack of racks) {
        codes[rack.id.toString()] = rack.code;
      }
      return codes;
    },
  });
}
