// What the restock pages' Tags stories share (backlog #87): the seed's tag ids and the writes the screens sent (from
// the stub's restockTagScenario.ts), a second problem restock, and the phone / desktop the stories are judged at.

import { RestockProblemType } from "../src/gen/warehouse/inventory/v1/restock_request_pb";
import { restockFixtures } from "./restockFixtures";
import { resetRestockStub } from "./restockStub";

export { TAG, restockTagScenario } from "./restockTagScenario";

/**
 * A `beforeEach`: 507 (accepted, Teh Melati 15 ordered) was counted 12 in, 3 MISSING — a second problem restock, so the
 * problem list has two rows, one with both kinds and one with missing only. The stub's reset reads its *Barang kurang*
 * off the problem rows, as the migration's data step does. Returns the restore.
 */
export function secondProblemRestock(): () => void {
  const fixture = restockFixtures.find((r) => r.id === 507n)!;
  const line = fixture.items[0]!;
  const saved = { received: line.receivedCount, problems: line.problems, placements: line.placements };

  line.receivedCount = 12n;
  line.problems = [{ type: RestockProblemType.MISSING, count: 3n, note: "" }];
  line.placements = [{ placementId: 42n, quantity: 12n }];
  resetRestockStub();

  return () => {
    line.receivedCount = saved.received;
    line.problems = saved.problems;
    line.placements = saved.placements;
    resetRestockStub();
  };
}

/** The 390px phone and the 1440 desktop the stories are judged at (addon-vitest merges these with MINIMAL_VIEWPORTS). */
export const TAG_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};
export const DESKTOP = { viewport: { value: "desktop1440" } };
export const PHONE = { viewport: { value: "phone390" } };
