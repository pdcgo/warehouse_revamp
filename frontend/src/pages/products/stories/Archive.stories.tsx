import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the archive (the-archive-is-a-page-of-its-own): its own page from the header's Arsip, Archive confirming
// first, Unarchive bringing a product back under the code it kept, and Delete — for good, and only for a product never
// used. The page's stories are grouped by the
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
  await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-LAMA")).toBeVisible());
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

    await expect(canvas.getByTestId("product-row-SL-03-ANG-001-L")).toHaveTextContent("Kemasan Lama");
    await expect(canvas.queryByTestId("product-row-SL-03-ANG-002")).toBeNull();
    await expect(canvas.getByTestId("restore-SL-03-ANG-LAMA")).toBeVisible();
    // The lock only READS on an archived row — no button to open its editor.
    await expect(canvas.getByTestId("lock-SL-03-ANG-LAMA")).toHaveTextContent("Open");
    await expect(canvas.getByTestId("lock-SL-03-ANG-LAMA").tagName).not.toBe("BUTTON");

    await userEvent.click(canvas.getByTestId("products-archive-back"));
    await waitFor(() => expect(canvas.getByTestId("products-page")).toBeInTheDocument());
    await expect(canvas.getByTestId("product-row-SL-03-ANG-002")).toBeVisible();
  },
};

/** Archive confirms first, naming the SKU — and the product moves to the archive. */
export const ArchiveConfirmsFirst: Story = {
  name: "Archive confirms",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("archive-SL-03-ANG-002"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SL-03-ANG-002");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SL-03-ANG-002")).toBeNull());

    await openArchived(canvas);
    await expect(canvas.getByTestId("product-row-SL-03-ANG-002")).toBeVisible();
  },
};

/** UNARCHIVE COMES BACK UNDER THE CODE IT KEPT (the-field-is-product-code-composed-on-write) — an archived product holds its
 * code, so nothing can have taken it and there is nothing to resolve: one click, no dialog, and it is live again under
 * the same code. */
export const UnarchiveComesBackUnderTheCodeItKept: Story = {
  name: "Unarchive, same code",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SL-03-ANG-001-L"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SL-03-ANG-001-L")).toBeNull());
    await expect(screen.queryByRole("dialog")).toBeNull();
    await expect(await screen.findByText(/"SL-03-ANG-001-L" unarchived/)).toBeVisible();
  },
};

/** DELETE, for good (a-used-product-is-archived-never-deleted) — offered on the Archived view, confirmed first. The edition
 * nobody ever stocked goes; one with a history is refused, and the toast says why: archive it instead. */
export const DeleteRemovesOnlyANeverUsedProduct: Story = {
  name: "Delete, never used only",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("delete-SL-03-ANG-001-L"));
    let dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await expect(await screen.findByText(/has a history/)).toBeVisible();
    await expect(canvas.getByTestId("product-row-SL-03-ANG-001-L")).toBeVisible();

    await userEvent.click(canvas.getByTestId("delete-SL-03-ANG-LAMA"));
    dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SL-03-ANG-LAMA");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SL-03-ANG-LAMA")).toBeNull());
  },
};
