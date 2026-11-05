import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSupplierDetailPage } from "../index";

// WHAT EVERY SUPPLIER-DISCOVER-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// Another team's supplier, read in full (another-team-sees-everything-of-a-supplier), from Discover Suppliers.
// Read-only, with the same Channels and Products tabs as the manage detail
// (supplier-detail-has-channels-and-products-tabs). The supplier and its stores are real reads of the stub's
// supplier_service (supplierStub.ts); the Products tab is still sample rows.

export function routedAt(supplierId: bigint) {
  return routedPage(
    [
      { path: "/inventories/suppliers/discover/:supplierId", element: <DiscoverSupplierDetailPage /> },
      marker("/inventories/suppliers/discover", "at-discover"),
    ],
    `/inventories/suppliers/discover/${supplierId}`,
  );
}

export const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // Toko Anggrek's — three stores on three marketplaces
const SINAR = supplierFixture("Toko Grosir Sinar"); // no stores at all

const AtNusantara = routedAt(NUSANTARA.id);
export const AtSinar = routedAt(SINAR.id);

/** Everything in a file's meta but its title. */
export const SUPPLIER_DISCOVER_DETAIL_META = {
  component: AtNusantara,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("discover-detail-page", {}, { timeout: 4000 });
  return canvas;
}
