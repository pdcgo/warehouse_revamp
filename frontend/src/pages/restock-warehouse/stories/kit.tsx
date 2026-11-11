import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehousePage } from "../index";

// WHAT EVERY RESTOCK-WAREHOUSE STORY FILE SHARES — the page's stories are split by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this
// folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the
// rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Gudang Pusat's (11) inbound queue, read by its floor crew (WAREHOUSE_STAFF). It opens on the last 7 days, so the rows
// are 501 (ongoing, Toko Melati), 502 (arrived) and 506 (ongoing, Toko Kenanga); the headline counts every restock
// still on its way or at the door, whatever the window.

export const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockWarehousePage /> },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/accept", "at-restock-accept"),
  ],
  "/inventories/restock",
);

/** Everything in a file's meta but its title. */
export const WAREHOUSE_META = {
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}
