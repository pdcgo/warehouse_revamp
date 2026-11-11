import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ShopsPage } from "../index";

// WHAT EVERY SHOPS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// THE SHOPS LIST — a selling team's marketplace storefronts (#66), on the screen rules
// (the-shop-screens-follow-the-screen-rules). The stub is shopStub.ts:
// a team sees only its own shops, a delete is soft, and the primary CS is a flag on a grant.
//
// Toko Melati (12) runs four: Melati Official (Shopee, primary CS Ani), Melati Store (Tokopedia, NO primary CS), Melati
// Grosir (Lazada, primary CS Eko) and Melati TikTok (TikTok, no grants). Kenanga Official is team 13's.

export const MELATI = 12n;

function asMelatiOwner() {
  asTeam(MELATI)();
  asRole(Role.SELLING_OWNER)();
}

export const Routed = routedPage(
  [{ path: "/shops", element: <ShopsPage /> }, marker("/shops/:shopId", "at-shop-detail")],
  "/shops",
);

/** Everything in a file's meta but its title. */
export const SHOPS_META = {
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asMelatiOwner,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("shop-row-MEL-SHP", {}, { timeout: 4000 });
  return canvas;
}
