import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { CategoriesPage } from "../index";

// WHAT EVERY CATEGORIES STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// THE CATEGORIES PAGE — the one global taxonomy, curated by Root and the Administrator (the nav gate), AS A TREE
// (the-category-page-is-a-tree) that READS LIKE THE APP'S TABLES (the-category-tree-reads-like-a-table): branches that
// open and close — shut on arrival, one button for all — how many sub-categories each holds, ＋ Sub-kategori under a
// node, and Ubah Nama · Pindahkan · Hapus in its ⋯. The stub is categoryStub.ts, writeable, with the server's rules:
//
//   ▸ Elektronik            1
//       ▸ Audio             1
//           Headphone
//   ▸ Rumah Tangga          1
//       Dapur
//
// a parent must exist, a name is unique under its parent, a delete is soft and refused while the category still has
// sub-categories.

export const At = (path: string) =>
  routedPage([{ path: "/categories", element: <><CategoriesPage /><LocationProbe /></> }], path);
const AtCategories = At("/categories");

/** Everything in a file's meta but its title. */
export const CATEGORIES_META = {
  component: AtCategories,
  parameters: { dataRouter: true },
};

const ALL = ["Elektronik", "Audio", "Headphone", "Rumah Tangga", "Dapur"];
export const TOP = ["Elektronik", "Rumah Tangga"];

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("category-row-51", {}, { timeout: 4000 });
  return canvas;
}

/** The names of the rows on screen, in reading order. */
export function visibleNames(canvasElement: HTMLElement) {
  return within(canvasElement)
    .getAllByTestId(/^category-name-/)
    .filter((el) => el.checkVisibility())
    .map((el) => el.textContent);
}

/** Open every branch with the one button — most rules are about a row the shut tree does not show. */
export async function openAll(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await userEvent.click(canvas.getByTestId("categories-toggle-all"));
  await waitFor(() => expect(visibleNames(canvasElement)).toEqual(ALL));
  return canvas;
}

export async function openDialog(trigger: HTMLElement) {
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}

/** Pick a node in the CategorySelect inside a dialog (it renders inline, so within the dialog). */
export async function pickParent(dialog: HTMLElement, name: string) {
  await userEvent.click(within(dialog).getByTestId("category-select"));
  const node = await within(dialog).findByTestId(`category-node-${name}`);
  await waitFor(() => expect(node).toBeVisible());
  await userEvent.click(node);
}
