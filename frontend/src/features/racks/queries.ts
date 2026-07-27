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

export function useRackCodes(args: { warehouseId: bigint; enabled?: boolean }) {
  const { warehouseId, enabled = true } = args;

  return useQuery({
    queryKey: key.racks(warehouseId, { codes: true }),
    enabled: enabled && warehouseId > 0n,
    queryFn: async () => {
      const res = await rackClient.rackList({
        teamId: warehouseId,
        dataRequest: rackListRowData(),
        page: { page: 1, limit: RACK_LOOKUP_SIZE },
      });

      const codes: Record<string, string> = {};
      for (const rack of racksFromList(res.items, res.ids)) {
        codes[rack.id.toString()] = rack.code;
      }

      return codes;
    },
  });
}
