import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RackDetailPage } from "../index";

// WHAT EVERY RACK-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is what the page leads with, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// Rack detail as Gudang Pusat's staff read it, one page of sections (a-rack-page-is-one-page-of-sections), with its writes:
// Move Goods, Record Sample and Report Found; rackStub.ts plays the decided rules.
//
// The shelves (rackStub.ts): A-01-1 (41) holds Kopi Arabika 71 ×12 (team 11), Gula Pasir 73 ×5 (Kenanga, 13) and
// Beras 74 ×8 (Melati, 12). A-01-2 (42) holds Kopi ×6 and Teh Melati 72 ×3, which a count is holding. B-02-1 (43) is
// empty.

export function routedAt(rackId: bigint) {
  return routedPage(
    [
      { path: "/inventories/racks/:rackId", element: <RackDetailPage /> },
      marker("/inventories/racks", "at-rack-list"),
    ],
    `/inventories/racks/${rackId}`,
  );
}

export const At41 = routedAt(41n);
export const At42 = routedAt(42n);
export const At43 = routedAt(43n);
// Opened from the list narrowed to "a-01" — the back goes there (a-form-returns-where-it-was-opened).
export const FromTheList = routedPage(
  [
    { path: "/inventories/racks/:rackId", element: <RackDetailPage /> },
    { path: "/inventories/racks", element: <LocationProbe /> },
  ],
  { pathname: "/inventories/racks/41", state: { from: "/inventories/racks?q=a-01" } },
);

/** Everything in a file's meta but its title. */
export const RACK_DETAIL_META = {
  component: At41,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
};

/** The page, its shelf read. */
export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("rack-detail-stock", {}, { timeout: 4000 });
  return canvas;
}

export async function type(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 40 });
}

// The dialog portals and every RackSelect in it renders its options inline, so an option is looked up inside ITS
// picker's root — a dialog with one picker per line has the same option ids several times over.
export async function pickRack(triggerTestId: string, rackId: bigint) {
  const trigger = await screen.findByTestId(triggerTestId);
  const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
  await userEvent.click(trigger);
  const option = await within(root).findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// The shelf's table (Produk) — its rows by product.
export const stock = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("rack-detail-stock"));

export async function openMove() {
  await userEvent.click(await screen.findByTestId("rack-action-move"));
  await screen.findByTestId("move-goods-dialog");
  await screen.findByTestId("move-line-71");
}

export async function openSample() {
  await userEvent.click(await screen.findByTestId("rack-action-sample"));
  await screen.findByTestId("record-sample-dialog");
}
