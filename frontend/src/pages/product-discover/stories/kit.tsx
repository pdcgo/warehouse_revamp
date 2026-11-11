import { within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { patchProduct } from "../../../../.storybook/productStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverProductsPage } from "../index";

// WHAT EVERY DISCOVER-PRODUCTS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one file
// per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// The cross-team browse (#106): every team's products, as a grid of cards, each naming its owner — with its filters in
// a panel beside the grid (discover-filters-in-a-side-panel) and the cross price on every card
// (discover-shows-the-cross-price).
//
// The stub's ProductDiscover ignores `team_id` exactly as the server does — the current team is the authorizing scope,
// never a filter — so all 48 fixture products are on offer: four named ones across three teams, then team 15's big
// catalogue. At the page's default of 20 that is pages of 20, 20 and 8.

export const SELLING_TEAM = 12n;

const byName = (name: string) => products.find((p) => p.name === name)!;

export const KOPI = byName("Kopi Arabika 250g"); // the warehouse's (11)
export const TEH = byName("Teh Melati 100g");
export const GULA = byName("Gula Pasir 1kg"); // the priority team's (13)
export const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's — the team standing here

/** Everything in a file's meta but its title. */
export const DISCOVER_PRODUCTS_META = {
  component: DiscoverProductsPage,
  parameters: { signedIn: true },
  beforeEach: () => {
    asTeam(SELLING_TEAM)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`discover-card-${KOPI.productCode}`, {}, { timeout: 4000 });
  return canvas;
}

export const cards = (canvas: ReturnType<typeof within>) => canvas.queryAllByTestId(/^discover-card-/);

// THE DESIGN AS THE OWNER ASKED IT — a product locked to other teams is ON Discover, with its badge (owner: *"lock bukan
// min di default tidak ada"*): Teh Melati is locked here, and this stub's ProductDiscover answers locked products, though
// the server does not send one yet (pending.ts `locked`). Kopi carries a minimum.
export const withALockedProduct = () => {
  patchProduct(TEH.id, { crossLocked: true });
};
