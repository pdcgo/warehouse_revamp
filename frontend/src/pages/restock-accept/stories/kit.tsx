import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { restockFixture } from "../../../../.storybook/restockFixtures";
import { resetRestockStub } from "../../../../.storybook/restockStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockAcceptPage } from "../index";

// WHAT EVERY RESTOCK-ACCEPT STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock rewrite (docs/business/inventory/restock_decision.md).
//
// The warehouse counts the box in (any-warehouse-member-counts-what-arrived): per line it types what is in the box and
// how many of those are broken; good and missing are worked out; the good units go onto placements; the courier's
// charge at the door is one amount with a note. The stub plays the accept handler's rules (restockStub.ts).
//
// Gudang Pusat (11), as WAREHOUSE STAFF — any member of the warehouse counts. Restock 502 has ARRIVED and its coffee
// line was edited 10 → 12 by the selling team, with a note; 501 is still ONGOING; 503 is already ACCEPTED.
//
// ⚠ THE RUNNER'S CANVAS IS PHONE-WIDTH, so Terima is the header's icon there (a-phone-header-action-is-an-icon) and a
// labelled button on a desktop — both carry the test id `accept-submit`.

export const ARRIVED = restockFixture(502n);
export const COFFEE = ARRIVED.items[0]!; // 12 ordered — "extra stock"
export const RICE = ARRIVED.items[1]!; // 5 ordered

export const A_01_1 = 41n;
export const A_01_2 = 42n;
export const B_02_1 = 43n;

/** The routes every story mounts: the page, and markers for where its ways out land. */
function routes() {
  return [
    { path: "/inventories/restock/:requestId/accept", element: <RestockAcceptPage /> },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock", "at-restock-list"),
  ];
}

export function routedAt(requestId: bigint) {
  return routedPage(routes(), `/inventories/restock/${requestId}/accept`);
}

/** The page opened by a screen that recorded itself in the navigation's state (lib/cameFrom). */
export function routedFrom(requestId: bigint, from: string) {
  return routedPage(routes(), { pathname: `/inventories/restock/${requestId}/accept`, state: { from } });
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
export const AtArrived = routedAt(502n);
export const AtOngoing = routedAt(501n);
export const AtAccepted = routedAt(503n);

/** Everything in a file's meta but its title. */
export const ACCEPT_META = {
  component: AtArrived,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-accept-page", {}, { timeout: 4000 });
  return canvas;
}

export async function lineOf(canvasElement: HTMLElement, productId: bigint) {
  const canvas = await loaded(canvasElement);
  return within(await canvas.findByTestId(`accept-line-${productId}`, {}, { timeout: 4000 }));
}

// A controlled field drops characters at machine speed — type with a delay.
export async function typeInto(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  if (value !== "") await userEvent.type(el, value, { delay: 40 });
}

export async function count(canvasElement: HTMLElement, productId: bigint, received: string, broken?: string) {
  const line = await lineOf(canvasElement, productId);
  await typeInto(line.getByTestId(`accept-received-${productId}`), received);
  if (broken !== undefined) await typeInto(line.getByTestId(`accept-broken-${productId}`), broken);
}

// RackSelect renders inline (no portal), so its options are found inside the row.
export async function place(canvasElement: HTMLElement, productId: bigint, index: number, placementId: bigint) {
  const line = await lineOf(canvasElement, productId);
  const field = within(line.getByTestId(`accept-placement-${productId}-${index}`));

  await userEvent.click(field.getByTestId("rack-select"));
  const option = await field.findByTestId(`rack-select-option-${placementId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await waitFor(() => expect(field.getByTestId("rack-select")).not.toHaveTextContent(/select a placement/i));
}

// Count a whole line as it should be: all arrived, nothing broken, onto one placement.
export async function countWhole(canvasElement: HTMLElement, productId: bigint, placementId: bigint) {
  const line = await lineOf(canvasElement, productId);
  await userEvent.click(line.getByTestId(`accept-all-arrived-${productId}`));
  await place(canvasElement, productId, 0, placementId);
  await waitFor(() => expect(line.getByTestId(`accept-balanced-${productId}`)).toBeInTheDocument());
}

// The charge is said as text and changed on Ubah (the-cod-paid-is-said-in-its-own-section), then asked first
// (the-charge-is-asked-for-before-it-is-filled) — Ubah, Ada, and its fields appear.
export async function askCharge(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await openCharge(canvasElement);
  await userEvent.click(canvas.getByTestId("accept-courier-asked-yes"));
  await canvas.findByTestId("accept-courier-charge");
}

/** Ubah — the charge's text turns into its form. */
export async function openCharge(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId("accept-courier-edit", {}, { timeout: 4000 }));
  await canvas.findByTestId("accept-courier-asked-yes");
}

/** Terima — the header's icon on a phone canvas, its labelled button on a desktop one; never behind a menu now. */
export function acceptControl(canvasElement: HTMLElement) {
  return within(canvasElement).getByTestId("accept-submit");
}

export async function expectAccept(canvasElement: HTMLElement, enabled: boolean) {
  const el = acceptControl(canvasElement);
  const blocked = () =>
    el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
  await waitFor(() => expect(blocked()).toBe(!enabled));
}

// A picture file the browser takes from a picker — the bytes do not matter, it is never sent.
export const PHOTO = () => new File([new Uint8Array([137, 80, 78, 71])], "rusak.png", { type: "image/png" });

// TERIMA STARTS FROM THE CHARGE NOTED AT TIBA (terima-starts-from-the-charge-noted-at-tiba) — Tandai Tiba keeps none yet,
// so a story gives 502 one by hand, and puts it back after.
export function arrivedWithACharge() {
  const saved = { cost: ARRIVED.warehouseAdditionalCost, note: ARRIVED.warehouseAdditionalCostNote };
  ARRIVED.warehouseAdditionalCost = 15000;
  ARRIVED.warehouseAdditionalCostNote = "Biaya COD";
  resetRestockStub();

  return () => {
    ARRIVED.warehouseAdditionalCost = saved.cost;
    ARRIVED.warehouseAdditionalCostNote = saved.note;
    resetRestockStub();
  };
}
