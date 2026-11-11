import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { supplierFixture, supplierFixtures } from "../../../../.storybook/supplierFixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSuppliersPage } from "../index";

// WHAT EVERY SUPPLIER-DISCOVER STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// Discover Suppliers (discover-searches-every-teams-suppliers): every team's suppliers, searched across teams,
// independent of the Suppliers page (a team's own list). The stub plays supplier_service's SupplierList with the
// EVERY_TEAM scope (supplierStub.ts) — twelve live suppliers kept by three teams, and one deleted.

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/discover", element: <DiscoverSuppliersPage /> },
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-detail"),
    marker("/inventories/suppliers/:supplierId", "at-manage-detail"),
  ],
  "/inventories/suppliers/discover",
);

export const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — the viewer's own team
export const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // team 15's — has a Lazada store
export const SINAR = supplierFixture("Toko Grosir Sinar"); // team 12's — no store // team 15's — its TikTok store is "linenhouse"
export const LIVE = supplierFixtures.filter((s) => !s.deleted);

/** Everything in a file's meta but its title. */
export const SUPPLIER_DISCOVER_META = {
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
};

export const rows = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("discover-suppliers-table")).queryAllByTestId(/^discover-supplier-row-/);

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`discover-supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}
