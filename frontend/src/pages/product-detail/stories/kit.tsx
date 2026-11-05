import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductDetailPage } from "../index";

// WHAT EVERY PRODUCT-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one file
// per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// A PRODUCT'S PAGE, IN THE ORDER DETAIL'S SHAPE (the-product-page-is-one-page-of-sections): a title row (back, the name
// with its SKU, the actions) that the sticky bar repeats in small, a navigation beside one page of sections in TWO ZONES
// (the-warehouse-picker-splits-the-page) — every warehouse above (Info with the total figures, Batch, Other teams,
// Activity, Derived ⚠), and the warehouse card below with its TABS (the-warehouse-zone-is-tabs): Overview (its figures,
// Suppliers ⚠), Cost price, Daily ⚠, Stock history. The stub is productStub.ts, its figures consistent across them:
//
//   700  SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan   (Toko Anggrek, team 15)
//        info        two pictures, a description, 12.5% markup, 4 held back
//        batch 7001  Gudang Pusat   ready 30 of 60  @ Rp 45.700
//        batch 7002  Gudang Cabang  ready 25 of 40  @ Rp 47.200
//        batch 7003  Gudang Pusat   ready 24 of 24  @ Rp 46.500     → 79 ready, Rp 3.667.000
//        history     receive 60, pick 30, receive 40, pick 15, receive 24 → balance 79
//   790  SKU-ANG-001  the archived older pack — its SKU now held by 700
//    74  another team's product — not found here

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products/:productId", element: <ProductDetailPage /> },
  marker("/products", "at-products"),
  marker("/products/archived", "at-products-archive"),
  marker("/products/:productId/edit", "at-product-edit"),
  // The two forms the page opens with this product on them (a-product-page-opens-the-order-and-restock-forms).
  markerWithSearch("/orders/new", "at-order-form"),
  markerWithSearch("/inventories/restock/new", "at-restock-form"),
];
export const At = (productId: number) => routedPage(routes, `/products/${productId}`);
export const AtMinyak = At(700);
export const AtTepung = At(702);
export const AtArchivedPack = At(790);

/** Everything in a file's meta but its title. */
export const PRODUCT_DETAIL_META = {
  component: AtMinyak,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-detail-page", {}, { timeout: 5000 });
  return canvas;
}

/** A section, found by its card — every section is on the page at once. */
export async function sectionOf(canvas: ReturnType<typeof within>, key: "info" | "batch" | "cross" | "derived" | "warehouse") {
  return within(await canvas.findByTestId(`pd-section-${key}`));
}

/** Open one of the warehouse card's tabs — only the open one is mounted (the-warehouse-zone-is-tabs). */
export async function openTab(canvas: ReturnType<typeof within>, key: "overview" | "suppliers" | "price" | "daily" | "history") {
  await userEvent.click(await canvas.findByTestId(`pd-tab-${key}`));
  await waitFor(() => expect(canvas.getByTestId(`pd-panel-${key}`)).toBeVisible());
  return within(canvas.getByTestId(`pd-panel-${key}`));
}
