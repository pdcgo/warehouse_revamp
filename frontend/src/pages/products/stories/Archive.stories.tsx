import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the archive (the-archive-is-a-page-of-its-own): its own page from the header's Arsip, Archive confirming
// first, and Restore — at once with a free SKU, under a new one when it collides. The page's stories are grouped by the
// part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Archive",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Into the archive — its own page, from the header's Arsip button. */
async function openArchived(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("open-archived-products"));
  await canvas.findByTestId("products-archive-page");
  await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible());
}

/** THE ARCHIVE IS A PAGE OF ITS OWN (the-archive-is-a-page-of-its-own) — Arsip in the header opens it, with its own title,
 * no figures and no lock or age filter; it holds the archived products only, none of which locks; Back returns to the
 * live list. There is no tab under the list any more. */
export const TheArchiveIsAPageOfItsOwn: Story = {
  name: "A page of its own",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("products-tab-archived")).toBeNull();
    await openArchived(canvas);

    await expect(canvas.getByRole("heading", { name: "Archived Products" })).toBeVisible();
    await expect(canvas.queryByTestId("products-stats")).toBeNull();
    await expect(canvas.queryByTestId("product-lock-filter")).toBeNull();
    await expect(canvas.queryByTestId("open-create-product")).toBeNull();

    await expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("Kemasan Lama");
    await expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull();
    await expect(canvas.getByTestId("restore-SKU-ANG-LAMA")).toBeVisible();
    // The lock only READS on an archived row — no button to open its editor.
    await expect(canvas.getByTestId("lock-SKU-ANG-LAMA")).toHaveTextContent("Open");
    await expect(canvas.getByTestId("lock-SKU-ANG-LAMA").tagName).not.toBe("BUTTON");

    await userEvent.click(canvas.getByTestId("products-archive-back"));
    await waitFor(() => expect(canvas.getByTestId("products-page")).toBeInTheDocument());
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();
  },
};

/** Archive confirms first, naming the SKU — and the product moves to the archive. */
export const ArchiveConfirmsFirst: Story = {
  name: "Archive confirms",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("delete-SKU-ANG-002"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SKU-ANG-002");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull());

    await openArchived(canvas);
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();
  },
};

/** Restoring under a SKU a live product took meanwhile is refused, naming the holder — and the screen asks for a new
 * SKU and restores under that. */
export const RestoreCollidesAndAsksForANewSku: Story = {
  name: "Restore, new SKU",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-001"));
    const dialog = await screen.findByTestId("restore-conflict-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");

    await userEvent.type(within(dialog).getByTestId("restore-new-sku"), "SKU-ANG-001-L", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restore-with-new-sku"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible();
  },
};

/** A free SKU restores at once — the product leaves the Archived tab. */
export const RestoreWithAFreeSku: Story = {
  name: "Restore, free SKU",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-LAMA"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-LAMA")).toBeNull());
    await expect(screen.queryByTestId("restore-conflict-dialog")).toBeNull();
  },
};
