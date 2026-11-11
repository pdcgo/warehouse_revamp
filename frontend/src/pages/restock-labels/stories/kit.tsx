import { userEvent, within } from "storybook/test";
import { type LoaderFunctionArgs, redirect } from "react-router-dom";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { labelsPath } from "../../../features/restock/labelsPath";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockLabelsPage } from "../index";
import { clearSettings } from "../settings";

// WHAT EVERY RESTOCK-LABELS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// The shelf labels printed by Gudang Pusat (11). 503 was counted in with 7 good rice on A-01-1 and B-02-1 and 20 tea on
// A-01-2 — every good unit is on a placement (there-is-no-unplaced-pile), so every label carries a placement code, and
// the 3 broken or missing units have none: 27 labels a piece, 3 a placement. 502 is at the door — signed for, not
// counted (labels-print-from-arrived). 501 is still on its way.
//
// The settings are remembered on the device (the-label-settings-are-remembered) — every story starts from the defaults.

// `probe` puts the address's query beside the page — for a story that reads the restocks written to it; hidden, so the
// page under review shows nothing that is not the page's own. The labels have ONE address (the-labels-have-one-address);
// the old one redirects to it by a loader, as the app's router does.
function routes(probe = false) {
  const page = probe ? (
    <>
      <RestockLabelsPage />
      <LocationProbe hidden />
    </>
  ) : (
    <RestockLabelsPage />
  );

  return [
    { path: "/inventories/restock/labels", element: page },
    {
      path: "/inventories/restock/:requestId/labels",
      loader: ({ params }: LoaderFunctionArgs) => redirect(labelsPath([params.requestId ?? ""])),
    },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock", "at-restock-list"),
  ];
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
export const At503 = routedPage(routes(), "/inventories/restock/labels?ids=503");
export const At501 = routedPage(routes(), "/inventories/restock/labels?ids=501");
export const At502 = routedPage(routes(), "/inventories/restock/labels?ids=502");
export const At503Probed = routedPage(routes(true), "/inventories/restock/labels?ids=503");
export const At503And502 = routedPage(routes(true), "/inventories/restock/labels?ids=503,502");
export const AtTheOldAddress = routedPage(routes(true), "/inventories/restock/503/labels");
/** 52 restocks in the address — the seven fixtures, then 45 numbers no restock has. */
export const AtFiftyTwo = routedPage(
  routes(true),
  `/inventories/restock/labels?ids=${[503, 502, 501, 504, 505, 506, 507, ...Array.from({ length: 45 }, (_, i) => 900 + i)].join(",")}`,
);
export const FromTheList = routedPage(routes(), {
  pathname: "/inventories/restock/labels",
  search: "?ids=503",
  state: { from: "/inventories/restock?status=accepted" },
});

/** Everything in a file's meta but its title. */
export const LABELS_META = {
  component: At503,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    clearSettings();
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    return () => clearSettings();
  },
};

/** The page, once its labels are on screen. */
export async function sheet(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("labels-sheet", {}, { timeout: 4000 });
  return canvas;
}

/** A paper's size on the PRINTED page, in mm — read off the print root's first paper. */
export function printedPaperMm(): { width: number; height: number } {
  const paper = document.querySelector<HTMLElement>("[data-testid='labels-print-root'] .label-paper")!;
  return { width: parseFloat(paper.style.width), height: parseFloat(paper.style.height) };
}

/** How many labels the print sends. */
export function printedLabels(): number {
  return document.querySelectorAll("[data-testid='labels-print-root'] .print-label").length;
}

// A controlled field drops characters at machine speed — type with a delay, then leave it.
export async function typeMeasure(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 30 });
  await userEvent.tab();
}
