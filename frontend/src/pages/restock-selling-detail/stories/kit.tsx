import { expect, userEvent, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockSellingDetailPage } from "../index";

// WHAT EVERY RESTOCK-SELLING-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this
// folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the
// rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// One restock as Toko Melati (12), the selling team that raised it, sees it. The stub plays the decided rules
// (restockStub.ts): cancel and mark lost from ongoing only, edits by status, every change a trail row. The fixtures
// are one per status — 501 ongoing, 502 arrived (an edit row in its trail), 503 accepted (2 broken, 1 missing, a
// courier's charge of 5.000), 504 lost, 505 cancelled, 507 accepted with a DELETED store on its line.

export function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockSellingDetailPage /> },
      marker("/inventories/restock/:requestId/edit", "at-restock-edit"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
export const At501 = routedAt(501n);
export const At502 = routedAt(502n);
export const At503 = routedAt(503n);
export const At504 = routedAt(504n);

/** Everything in a file's meta but its title. */
export const SELLING_DETAIL_META = {
  component: At501,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
  return canvas;
}

// ONE PAGE OF SECTIONS now (the-restock-detail-is-the-product-pages-shape): every section is mounted, so "opening" one is
// a jump from the navigation — the nav item for it, as somebody reading the page would click.
export async function openTab(canvas: ReturnType<typeof within>, tab: "info" | "products" | "timeline") {
  const key = tab === "info" ? "delivery" : tab;
  await userEvent.click(canvas.getByTestId(`section-nav-${key}`));
  await expect(canvas.getByTestId(`restock-detail-${tab === "info" ? "info" : tab === "products" ? "products" : "timeline"}`)).toBeInTheDocument();
}

export function trailRows(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-timeline-'][data-kind]")];
}
