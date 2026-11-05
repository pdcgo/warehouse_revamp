import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { restockFixture } from "../../../../.storybook/restockFixtures";
import { resetRestockStub } from "../../../../.storybook/restockStub";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockFormPage } from "../index";

// WHAT EVERY RESTOCK-FORM STORY FILE SHARES — the page's stories are split by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this
// folder one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the
// rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock form against the decided design
// (docs/business/inventory/restock_decision.md). The stub plays the restock rules (restockStub.ts) and supplier_service
// (supplierStub.ts).
//
// Toko Melati (12) raises restocks into Gudang Pusat (11). 501 is ongoing (every field), 502 arrived (the lines only),
// 503 accepted (not editable). Team 12's catalogue holds three products: Beras 74, Tepung 75, Kecap 76.

export const ONGOING = restockFixture(501n);
export const ARRIVED = restockFixture(502n);
export const ACCEPTED = restockFixture(503n);

export const BERAS = 74n; // team 12's own products
export const TEPUNG = 75n;
export const KECAP = 76n;
export const CAHAYA = supplierFixture("CV Cahaya Abadi");
export const CAHAYA_STORE = 321n;

export const Create = routedPage(
  [
    { path: "/inventories/restock/new", element: <RestockFormPage key="create" /> },
    marker("/inventories/restock", "at-restock-list"),
  ],
  "/inventories/restock/new",
);

export function routedEdit(requestId: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/edit", element: <RestockFormPage key="edit" /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${requestId}/edit`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
export const EditOngoing = routedEdit(ONGOING.id);
export const EditArrived = routedEdit(ARRIVED.id);
export const EditAccepted = routedEdit(ACCEPTED.id);

/** Everything in a file's meta but its title. */
export const FORM_META = {
  component: Create,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export type Canvas = ReturnType<typeof within>;

export async function loaded(canvasElement: HTMLElement, testId: string) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(testId, {}, { timeout: 4000 });

  return canvas;
}

/** Tick products in the picker dialog and confirm. The dialog portals, so its rows are on `screen`. */
export async function pickProducts(canvas: Canvas, productIds: bigint[]) {
  await userEvent.click(canvas.getByTestId("restock-pick-products"));

  for (const id of productIds) {
    const row = await screen.findByTestId(`product-picker-option-${id}`, {}, { timeout: 4000 });
    await waitFor(() => expect(row).toBeVisible());
    await userEvent.click(row);
  }

  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
  await waitFor(() => expect(screen.queryByTestId("product-picker-dialog")).toBeNull());
}

/**
 * Connect a supplier in an open SupplierChannelPicker — `prefix` is its testId. Without a store the supplier is a stall,
 * whose "no store" is chosen for it.
 */
export async function connectSupplier(prefix: string, search: string, supplierId: bigint, storeId?: bigint) {
  const dialog = within(await screen.findByTestId(`${prefix}-dialog`, {}, { timeout: 4000 }));

  await userEvent.type(dialog.getByTestId(`${prefix}-search`), search, { delay: 20 });
  await userEvent.click(await dialog.findByTestId(`${prefix}-supplier-${supplierId}`, {}, { timeout: 4000 }));
  if (storeId !== undefined) {
    await userEvent.click(await dialog.findByTestId(`${prefix}-store-${storeId}`, {}, { timeout: 4000 }));
  }
  await waitFor(() => expect(dialog.getByTestId(`${prefix}-confirm`)).toBeEnabled(), { timeout: 4000 });
  await userEvent.click(dialog.getByTestId(`${prefix}-confirm`));
  await waitFor(() => expect(screen.queryByTestId(`${prefix}-dialog`)).toBeNull());
}

/** 501 with every line bought from Cahaya's site — for the edit that opens with a supplier for all. */
export function ongoingFromOneSupplier() {
  const saved = ONGOING.items;
  ONGOING.items = saved.map((l) => ({ ...l, supplierId: CAHAYA.id, supplierChannelId: CAHAYA_STORE }));
  resetRestockStub();

  return () => {
    ONGOING.items = saved;
    resetRestockStub();
  };
}
