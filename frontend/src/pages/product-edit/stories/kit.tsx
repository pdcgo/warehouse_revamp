import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductEditPage } from "../index";

// WHAT EVERY PRODUCT-FORM STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one file
// per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// THE PRODUCT FORM — one page for New (/products/new) and Edit (/products/:id/edit), AS THE SCREEN STANDS TODAY: the
// gallery beside the record, the SKU, name, description and a LEAF category, the hold-back, the markup another team
// pays, and the lock. The stub is productStub.ts, writeable, with the server's rule that a SKU is held once among the
// live — so a story can save and then read back what was sent.
//
//   700  SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan   two pictures, a description, 12.5% markup, 4 held back
//   categories        Elektronik › Audio › Headphone, Rumah Tangga › Dapur — only Headphone and Dapur are leaves

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

export const routes = [
  { path: "/products/new", element: <ProductEditPage /> },
  { path: "/products/:productId/edit", element: <ProductEditPage /> },
  marker("/products", "at-products"),
  marker("/products/:productId", "at-product-detail"),
];
export const AtNew = routedPage(routes, "/products/new");
// Reached by a pasted link — no screen opened it, so there is no "came from" (the-form-returns-where-it-was-opened).
export const AtEditMinyak = routedPage(routes, "/products/700/edit");

/** Everything in a file's meta but its title. */
export const PRODUCT_FORM_META = {
  component: AtNew,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-edit-page", {}, { timeout: 5000 });
  return canvas;
}

export async function loadedMinyak(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("product-edit-sku")).toHaveValue("SKU-ANG-001"));
  return canvas;
}

/** Retype a field from empty — a controlled input, so slowly enough that no keystroke is dropped. */
export async function retype(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  if (text !== "") await userEvent.type(field, text, { delay: 30 });
}

/** A real (if plain) PNG, so the thumbnail shows the picture that was picked rather than a broken image. */
export async function picture(name: string, colour: string): Promise<File> {
  const board = document.createElement("canvas");
  board.width = board.height = 96;
  const pen = board.getContext("2d")!;
  pen.fillStyle = colour;
  pen.fillRect(0, 0, 96, 96);
  const blob = await new Promise<Blob>((resolve) => board.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

export async function attach(canvasElement: HTMLElement, files: File[]) {
  const input = canvasElement.querySelector<HTMLInputElement>('[data-testid="product-images-input"] input[type="file"]');
  await expect(input).not.toBeNull();
  await userEvent.upload(input!, files, { applyAccept: false });
}
