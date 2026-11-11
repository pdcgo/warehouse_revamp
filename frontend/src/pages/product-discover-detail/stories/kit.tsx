import { expect, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../../.storybook/fixtures";
import { asTeam, marker, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import { patchProduct } from "../../../../.storybook/productStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverProductDetailPage } from "../index";

// WHAT EVERY DISCOVER-PRODUCT-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder
// one file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from
// here.
//
// ANOTHER team's product, as a selling team deciding whether to sell it — the discover detail, in the owner's page's
// shape (the-discover-detail-is-the-product-page).
//
// Team 12 (Toko Melati) stands here. The fixture stock is one building's (Gudang Pusat, 11), and the stub
// answers the second warehouse (Gudang Cabang, 14) with zeros — so every page shows one stocked row and
// one empty one, which is the comparison the table exists for.

const SELLING_TEAM = 12n;

const byName = (name: string) => products.find((p) => p.name === name)!;

export const GULA = byName("Gula Pasir 1kg"); // Toko Kenanga's (13), 1.5% markup, no reserve — its division a sample Riset
export const KOPI = byName("Kopi Arabika 250g"); // reserves 2 of its 40
export const TEH = byName("Teh Melati 100g"); // the one a story locks or archives
export const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's own

export const STOCKED = teams[0]!; // Gudang Pusat
export const EMPTY = teams[3]!; // Gudang Cabang

export function routedAt(productId: bigint | string) {
  return routedPage(
    [
      { path: "/products/discover/:productId", element: <DiscoverProductDetailPage /> },
      marker("/products/discover", "at-discover"),
      marker("/products/:productId", "at-own-product"),
      marker("/inventories/suppliers/discover/:supplierId", "at-supplier"),
      markerWithSearch("/orders/new", "at-order-form"),
    ],
    `/products/discover/${productId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
export const AtGula = routedAt(GULA.id);
export const AtKopi = routedAt(KOPI.id);
export const AtTeh = routedAt(TEH.id);
export const AtBeras = routedAt(BERAS.id);

/** A `beforeEach` that flips one flag on Teh for the story — in the product stub, whose reset puts it back. */
export function tehIs(flag: "crossLocked" | "archived") {
  return () => patchProduct(TEH.id, { [flag]: true });
}

// A FLAT DRAWING OF A BAG OF SUGAR, as the fixtures draw Beras's rice — so the Default story shows the product's picture
// (owner: *"gambar produk ada"*). Given to Gula for this file only, through the stub, whose reset takes it back.
export const SUGAR_PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#e0f2fe"/>` +
    `<path d="M18 14h28l4 40H14z" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>` +
    `<rect x="20" y="28" width="24" height="12" fill="#0284c7"/>` +
    `</svg>`,
)}`;

/** Everything in a file's meta but its title. */
export const DISCOVER_PRODUCT_DETAIL_META = {
  component: AtGula,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(SELLING_TEAM)();
    asRole(Role.SELLING_OWNER)();
    patchProduct(GULA.id, { defaultImageUrl: SUGAR_PICTURE, defaultImageThumbnailUrl: SUGAR_PICTURE });
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("discover-detail-page", {}, { timeout: 4000 });
  return canvas;
}

/** A section's own queries — the sections are cards on one page. */
export async function sectionOf(canvas: ReturnType<typeof within>, key: "info" | "derived" | "price" | "warehouse") {
  return within(await canvas.findByTestId(`dd-section-${key}`));
}

/** Open one tab of the Per Gudang card, and query its panel. */
export async function openTab(canvas: ReturnType<typeof within>, key: "overview" | "suppliers" | "daily" | "history") {
  await userEvent.click(await canvas.findByTestId(`dd-tab-${key}`));
  await waitFor(() => expect(canvas.getByTestId(`dd-panel-${key}`)).toBeVisible());
  return within(canvas.getByTestId(`dd-panel-${key}`));
}

export async function stockLoaded(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await canvas.findByTestId(`discover-stock-row-${STOCKED.id}`, {}, { timeout: 4000 });
  return canvas;
}
