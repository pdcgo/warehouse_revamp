import { within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "../index";

// WHAT EVERY PRODUCTS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one file
// per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// THE PRODUCTS LIST — a selling team's catalogue: the stat row, the search and the warehouse lens, a row per product
// with its stock, cost and sales figures, the lock in the row, Edit and Archive — and the ARCHIVE, a page of its own
// opened from the header's Arsip button (the-archive-is-a-page-of-its-own), each row there offering Restore. The stub is
// productStub.ts, writeable, with the server's rules — a SKU once among the live, archive is soft, restore can collide.
//
// Toko Anggrek (team 15) holds 44 live products with invented but consistent figures:
//
//   SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan     79 ready (30 + 24 in Gudang Pusat, 25 in Gudang Cabang)
//   SKU-ANG-003  Tepung Terigu Serbaguna 1kg — Satuan nothing on a shelf
//   archived:    SKU-ANG-001 (an older pack — its SKU now taken by the live one), SKU-ANG-LAMA

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe /></> },
  { path: "/products/archived", element: <><ProductsPage archived /><LocationProbe /></> },
  marker("/products/new", "at-product-new"),
  marker("/products/:productId", "at-product-detail"),
  marker("/products/:productId/edit", "at-product-edit"),
];
export const At = (path: string) => routedPage(routes, path);
export const AtProducts = At("/products");

/** Everything in a file's meta but its title. */
export const PRODUCTS_META = {
  component: AtProducts,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-row-SKU-ANG-001", {}, { timeout: 5000 });
  return canvas;
}
