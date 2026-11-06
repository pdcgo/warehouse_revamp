import { within } from "storybook/test";

import { asTeam, marker, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehouseDetailPage } from "../index";

// WHAT EVERY RESTOCK-WAREHOUSE-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this
// folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the
// rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// One delivery as Gudang Pusat (11), the receiving warehouse, sees it — read by a member of the floor crew
// (WAREHOUSE_STAFF): any warehouse member signs and accepts (any-warehouse-member-counts-what-arrived). The stub plays
// the decided rules (restockStub.ts): Arrive from ongoing or lost, Accept from ongoing or arrived.

export function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockWarehouseDetailPage /> },
      marker("/inventories/restock/:requestId/accept", "at-restock-accept"),
      // The labels' one address (the-labels-have-one-address) — static, so it ranks above :requestId.
      markerWithSearch("/inventories/restock/labels", "at-restock-labels"),
      marker("/inventories/restock/:requestId/receipt", "at-restock-receipt"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
}

export const At501 = routedAt(501n);
export const At502 = routedAt(502n);
export const At503 = routedAt(503n);
export const At504 = routedAt(504n);
export const At505 = routedAt(505n);
export const At507 = routedAt(507n);

/** Everything in a file's meta but its title. */
export const WAREHOUSE_DETAIL_META = {
  component: At501,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
  return canvas;
}

/** The title row's acts — the page's own copy; the sticky bar's (`-sticky`) is the same set again. */
export function actionsIn(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")]
    .map((el) => el.dataset.testid ?? "")
    .filter((id) => !id.endsWith("-sticky"));
}

export function trailRows(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-timeline-'][data-kind]")];
}
