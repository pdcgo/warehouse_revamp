import { expect, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { settlementImportLines, settlementImports, shops, teams } from "../../../../.storybook/fixtures";
import { SettlementImportDetailPage } from "../index";

// WHAT EVERY IMPORT-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with (Default), this
// folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the
// rest from here.
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
];
export const AtShopeeDone = routedPage(routes, `/settlement/imports/${shopeeDone!.id}`);
export const AtTiktokDone = routedPage(routes, `/settlement/imports/${tiktokDone!.id}`);
export const AtInterrupted = routedPage(routes, `/settlement/imports/${interrupted!.id}`);
export const AtFailed = routedPage(routes, `/settlement/imports/${failed!.id}`);
export const AtUnknown = routedPage(routes, "/settlement/imports/999");

/** Everything in a file's meta but its title. */
export const IMPORT_DETAIL_META = {
  component: SettlementImportDetailPage,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(TEAM.id),
  render: () => <AtShopeeDone />,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("import-detail-shop")).toBeInTheDocument(), { timeout: 3000 });
  return canvas;
}
