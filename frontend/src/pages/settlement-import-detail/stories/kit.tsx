import { expect, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { settlementImportLines, settlementImports, shops, teams } from "../../../../.storybook/fixtures";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { UploadedFileLineOutcome } from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { SettlementImportDetailPage } from "../index";

// WHAT EVERY IMPORT-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with (Default, then
// Mobile), this folder one file per part — the desktop's File, States and Rows, the phone's Phone and PhoneRows. Each
// file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// One imported statement (docs/business/settlement/settlement_importer_decision.md): what it posted, and the rows worth
// a look — held, skipped, or posted to the shop because their order was not found — then every posted row and every row
// already there, so each row is shown with its result. The tallies on the page and the rows under each view come from
// the same fixture book, so a story checks one against the other.

export const TEAM = teams.find((t) => t.id === 12n)!; // Toko Melati
export const [shopeeDone, tiktokDone, interrupted, failed] = settlementImports;
export const shopOf = (id: bigint) => shops.find((s) => s.id === id)!;
export const linesOf = (fileId: bigint, pick: (l: (typeof settlementImportLines)[number]) => boolean) =>
  settlementImportLines.filter((l) => l.uploadedFileId === fileId).filter(pick);

// Built ONCE per starting URL, at module scope (see pageStory.tsx).
const routes = [
  { path: "/settlement/imports/:fileId", element: <SettlementImportDetailPage /> },
  marker("/settlement/imports", "at-imports"),
  // Where an order link lands — a story can tell a link that opened from a tap that did not.
  marker("/orders/:orderId", "at-order"),
];
export const AtShopeeDone = routedPage(routes, `/settlement/imports/${shopeeDone!.id}`);
export const AtTiktokDone = routedPage(routes, `/settlement/imports/${tiktokDone!.id}`);
export const AtInterrupted = routedPage(routes, `/settlement/imports/${interrupted!.id}`);
export const AtFailed = routedPage(routes, `/settlement/imports/${failed!.id}`);
export const AtUnknown = routedPage(routes, "/settlement/imports/999");

// The phone the page was accepted at (390px), beside Storybook's own `mobile1` (320px), and a 1366 desktop.
const VIEWPORTS = {
  ...PHONE_VIEWPORTS,
  desktop1366: { name: "Desktop 1366", styles: { width: "1366px", height: "900px" }, type: "desktop" },
};

/** Everything in a file's meta but its title. */
export const IMPORT_DETAIL_META = {
  component: SettlementImportDetailPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: asTeam(TEAM.id),
  render: () => <AtShopeeDone />,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("import-detail-shop")).toBeInTheDocument(), { timeout: 3000 });
  return canvas;
}

// ── Shared by the stories of the rows ────────────────────────────────────────────────────────────────────────────

export const heldLines = () => linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.HELD);
export const postedLines = () => linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.POSTED);
export const rowsShown = (canvasElement: HTMLElement) => canvasElement.querySelectorAll('[data-testid^="line-row-"]');

// NOTHING RUNS PAST THE SCREEN'S EDGE (nothing-runs-past-a-phones-edge) — not the page, not a block, not a line in one.
export async function fitsTheScreen(canvasElement: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
  const list = within(canvasElement).queryByTestId("lines-table");
  if (!list) return;
  await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  for (const block of Array.from(list.children)) {
    await expect(block.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
  }
}
