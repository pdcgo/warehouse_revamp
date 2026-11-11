import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { channelFixture, supplierFixture } from "../../../../.storybook/supplierFixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { SupplierDetailPage } from "../index";

// WHAT EVERY SUPPLIER-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// One supplier: its own fields on top, then two horizontal tabs (supplier-detail-has-channels-and-products-tabs)
// — CHANNELS, one list with a marketplace badge per row, and PRODUCTS, sample rows until an accepted restock links
// a product to its store. The stub plays supplier_service (supplierStub.ts): reads cross teams, writes do not, and
// deletes are soft.

export const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const BANYAK = supplierFixture("PT Banyak Toko"); // twelve channels — more than a page

export const SHOPEE_STORE = channelFixture(311n);
export const TOKOPEDIA_STORE = channelFixture(312n);

export function routedAt(supplierId: bigint) {
  return routedPage(
    [
      { path: "/inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
      marker("/inventories/suppliers", "at-suppliers"),
    ],
    `/inventories/suppliers/${supplierId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
export const AtCahaya = routedAt(CAHAYA.id);
export const AtSinar = routedAt(SINAR.id);
export const AtBanyak = routedAt(BANYAK.id);

/** Everything in a file's meta but its title. */
export const SUPPLIER_DETAIL_META = {
  component: routedAt(SUMBER.id),
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("supplier-detail-page", {}, { timeout: 4000 });
  return canvas;
}

export async function openProducts(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("supplier-tab-products"));
  await waitFor(() => expect(canvas.getByTestId("supplier-tab-products")).toHaveAttribute("aria-selected", "true"));
}
