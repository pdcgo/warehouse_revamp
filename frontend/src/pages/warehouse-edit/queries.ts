import { useMutation } from "@tanstack/react-query";
import { teamClient, warehouseInfoClient } from "../../api/clients";
import { useInvalidateTeams } from "../../features/teams/queries";
import { useInvalidateWarehouseInfo } from "../../features/warehouse/queries";

// The warehouse screens' writes (#177).
//
// ⚠ THIS HOOK EXISTS BECAUSE OF A REGRESSION THE CACHE INTRODUCED, and it is worth recording rather
// than quietly fixing. A warehouse IS a team (a team of type WAREHOUSE), so editing one writes
// team_service — but this page lives outside `src/teams/`, so when the team list moved to `useQuery`
// nothing here knew it had to invalidate. The save succeeded, the toast appeared, and the Teams page
// went on showing the old name for the full 30s `staleTime`.
//
// That is the failure mode caching trades for the one it removes, and it does not announce itself.
// The lesson generalises: the question is never "is this my domain's data?" but "whose cache did I
// just make wrong?" — and the answer is a property of the RPC, not of the directory the caller
// happens to sit in.

// The hours fields are taken FROM THE CLIENT METHOD, not restated: `dayHoursFromWeek` builds plain
// init objects, and the generated `DayHours` message additionally carries `$typeName`, so a
// hand-written copy of the shape rejects exactly the value the caller has.
interface SaveWarehouseVars
  extends Pick<
    Parameters<typeof warehouseInfoClient.warehouseInfoUpdate>[0],
    "operatingHours" | "receivingHours" | "location"
  > {
  teamId: bigint;
  name: string;
  description: string;
}

// Two RPCs, one act: the team fields, then the warehouse hours.
//
// Sequential and NOT wrapped in anything transactional, which is the honest position — there are two
// writes against one service and no way to make them atomic from here. If the second fails the first
// has already landed, so the page reports the error against a partly-saved warehouse. That was true
// before this hook too; naming it here is the only change.
//
// It stales the warehouse's PROFILE too (its hours, its location, whether it receives orders now) — the team page's
// Gudang section and the order form's closed-day warning read it (#122). Keyed so the edit page can keep its own reads
// still while it runs (SAVE_WAREHOUSE): the page leaves on success, and the team page it opens reads both afresh.
export const SAVE_WAREHOUSE = ["teams", "write", "warehouse"] as const;

export function useSaveWarehouse() {
  const invalidateTeams = useInvalidateTeams();
  const invalidateWarehouseInfo = useInvalidateWarehouseInfo();

  return useMutation({
    mutationKey: SAVE_WAREHOUSE,
    mutationFn: async ({ teamId, name, description, ...info }: SaveWarehouseVars) => {
      await teamClient.teamUpdate({ teamId, name, description });
      await warehouseInfoClient.warehouseInfoUpdate({ teamId, ...info });
    },
    onSuccess: (_answer, vars) => Promise.all([invalidateTeams(), invalidateWarehouseInfo(vars.teamId)]),
  });
}
