import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { AtArchivedPack, PRODUCT_DETAIL_META, loaded } from "./kit";

// PRODUCT DETAIL — an archived product: reached by URL it says so, Archive confirms first, Unarchive brings it back
// under the code it kept, and Back returns to the archive. The page's stories are grouped by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Archive",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** An archived product — reachable by URL, so the page says so and offers Restore instead of Edit. */
export const AnArchivedProduct: Story = {
  name: "Archived",
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-detail-archived")).toBeVisible();
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
    await expect(canvas.queryByTestId("product-detail-edit")).toBeNull();
  },
};

/** Archive confirms first, naming the SKU — and the page then says the product is archived. */
export const ArchiveConfirmsFirst: Story = {
  name: "Archive confirms",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SL-03-ANG-001");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("product-detail-archived")).toBeVisible());
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
  },
};

/** Unarchiving the older pack brings it back under the code it KEPT — nothing could take it while it was archived, so
 * there is no dialog to answer (the-field-is-product-code-composed-on-write). */
export const UnarchiveComesBackUnderTheCodeItKept: Story = {
  name: "Unarchive, same code",
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-restore"));

    await waitFor(() => expect(canvas.queryByTestId("product-detail-archived")).toBeNull());
    await expect(screen.queryByRole("dialog")).toBeNull();
    await expect(canvas.getByTestId("product-detail-sku")).toHaveTextContent("SL-03-ANG-001-L");
  },
};

/** An archived product's Back returns to the archive it was opened from (the-archive-is-a-page-of-its-own). */
export const AnArchivedProductGoesBackToTheArchive: Story = {
  name: "Back to the archive",
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products-archive")).toBeInTheDocument());
  },
};
