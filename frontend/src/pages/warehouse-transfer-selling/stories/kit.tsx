import { within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { transferLogByForStory, transferRaisedByForStory } from "../../../../.storybook/warehouseTransferStub";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { WarehouseTransferSellingPage } from "../index";

// WHAT EVERY TRANSFER-SELLING STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with (Default, Mobile),
// this folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads
// the rest from here.
//
// The warehouse transfer decisions (docs/business/inventory/warehouse_transfer_decision.md), on the Storybook stub, which
// plays the same rules as the server. Toko Melati's (12) transfers: 601 created, 602 process, 603 shipped, 604 arrived,
// 605 accepted with problems, 606 cancelled, 607 lost, 608 shipped the other way. Toko Kenanga's 609 is NOT here — a
// team sees only its own.

/** The page at a URL, with the location under it (hidden) so a story can read what the URL carries. */
export function sellingAt(entry: string) {
  return routedPage(
    [
      { path: "/inventories/transfer", element: <><WarehouseTransferSellingPage /><LocationProbe hidden /></> },
      marker("/inventories/transfer/new", "at-transfer-new"),
      marker("/inventories/transfer/:transferId", "at-transfer-detail"),
    ],
    entry,
  );
}

export const Routed = sellingAt("/inventories/transfer");

/** Everything in a file's meta but its title. */
export const SELLING_META = {
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement, first = "transfer-row-601") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  return canvas;
}

// OPENED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): Fajar, a Root, opened 601 inside Toko Melati, which
// he is not in — read from the create's trail row.
export const openedByRoot = () => {
  transferRaisedByForStory(601n, 66n);
  transferLogByForStory(601n, 1n, 66n, true);
};
