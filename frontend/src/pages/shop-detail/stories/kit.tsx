import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ShopDetailPage } from "../index";

// WHAT EVERY SHOP DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// A SHOP'S PAGE (#85) — its fields, and who may work on it (#86), on the screen rules
// (the-shop-screens-follow-the-screen-rules). The stub is shopStub.ts:
// a team reads only its own shops, and the primary CS is a flag on a grant — the FIRST user granted becomes it, and
// removing the primary's grant leaves none.
//
//   21 Melati Official — Shopee; Ani (primary) and Budi
//   22 Melati Store    — Tokopedia; nobody, so NO primary CS
//   24 Kenanga Official — team 13's, so NOT FOUND for Toko Melati

export function asMelatiOwner() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/shops/:shopId", element: <ShopDetailPage /> },
  marker("/shops", "at-shops"),
  marker("/financial-accounts", "at-accounts"),
  marker("/financial-accounts/:accountId", "at-account"),
];
export const At = (shopId: number) => routedPage(routes, `/shops/${shopId}`);
const AtOfficial = At(21);
export const AtStore = At(22);

/** Everything in a file's meta but its title. */
export const SHOP_DETAIL_META = {
  component: AtOfficial,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asMelatiOwner,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("shop-detail-page", {}, { timeout: 4000 });
  return canvas;
}
