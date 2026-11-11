import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the top of the list: the page naming itself and New Product, and the stat row — the catalogue counted, its
// stock added up, in the order list's card strip. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Header",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page names itself — there is no top bar over it any more (the-desktop-shell-has-no-top-bar) — and New Product
 * carries its ＋ (an-action-button-carries-its-icon). */
export const ThePageNamesItself: Story = {
  name: "Names itself",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(canvas.getByTestId("products-page")).toHaveTextContent("Toko Anggrek");
    await expect(canvas.getByTestId("open-create-product").querySelector("svg")).not.toBeNull();
  },
};

/** The stat row counts the live catalogue and adds up its stock; each row carries its own figures — a product with
 * nothing on a shelf reads 0 pcs, a stock read that answered, not an unknown. */
export const TheCatalogueAndItsFigures: Story = {
  name: "Catalogue and its figures",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("products-total-value")).toHaveTextContent(/^44$/));
    await waitFor(() => expect(canvas.getByTestId("products-ready-stock")).toHaveTextContent("pcs"));
    await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-001")).toHaveTextContent("79 pcs"));
    await expect(canvas.getByTestId("product-row-SL-03-ANG-001")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
    await expect(canvas.getByTestId("product-row-SL-03-ANG-003")).toHaveTextContent("0 pcs");
  },
};

/** The figures are the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — grey cards, each a
 * label, one figure and a quiet line. */
export const TheFiguresAreTheCardStrip: Story = {
  name: "Card strip",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const strip = canvas.getByTestId("products-stats");

    await expect(within(strip).getAllByTestId(/^products-[a-z-]+-value$/)).toHaveLength(5);
    await waitFor(() => expect(canvas.getByTestId("products-ready-stock")).toHaveTextContent("at cost"));
  },
};
