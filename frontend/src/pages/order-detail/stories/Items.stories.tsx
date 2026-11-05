import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { FULL, ORDER_DETAIL_META, Routed } from "./kit";

// ONE ORDER — the lines — the price with its owner's markup, the picture, the placeholder.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Items",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A BORROWED LINE IS PRICED WITH ITS OWNER'S MARKUP (the-cross-charge-lives-on-the-line).
 *
 * Harga beli is what one unit cost the SELLER — `unit_cost_with_markup` — never the bare drawn cost, so the line adds
 * up to the order's `goods_cost` and total sistem is that plus the fee, as on the list's Beli cell.
 */
const AtBorrowed = Routed("/orders/105");

export const ABorrowedLineIsPricedWithItsMarkup: Story = {
  name: "Borrowed, with markup",
  render: () => <AtBorrowed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());

    // 157.867 drawn + 31.573 markup = 189.440 a unit, one unit.
    const line = canvas.getByTestId("order-item-1");
    await expect(line).toHaveTextContent("Rp 189.440");
    await expect(line).not.toHaveTextContent("Rp 157.867");

    // goods_cost 189.440 + the frozen fee 2.000.
    await expect(canvas.getByTestId("tile-system")).toHaveTextContent("Rp 191.440");
  },
};

/**
 * A LINE SHOWS ITS PRODUCT — "gambar nama sku": the picture, the name, the SKU.
 *
 * `OrderItem` carries no picture; the page reads it off `Product` with one batched `ProductByIds` for every line. 106's
 * line is on Beras (74), the fixture product drawn with a picture. 101's lines name products the catalogue does not
 * answer for, and they keep the placeholder — the line is still there in full, never blanked.
 */
const AtPictured = Routed("/orders/106");
const BERAS = products.find((p) => p.id === 74n)!;

export const ALineShowsItsProductPicture: Story = {
  name: "Picture, name, SKU",
  render: () => <AtPictured />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());
    const line = canvas.getByTestId("order-item-1");

    await waitFor(() => expect(within(line).getByRole("img")).toHaveAttribute("src", BERAS.defaultImageThumbnailUrl));
    await expect(line).toHaveTextContent(BERAS.name);
    await expect(line).toHaveTextContent(BERAS.sku);
  },
};

export const ALineWithNoPictureKeepsThePlaceholder: Story = {
  name: "No picture",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());

    for (const item of FULL.items) {
      const line = canvas.getByTestId(`order-item-${item.id}`);
      await expect(line).toHaveTextContent(item.name);
      await expect(line).toHaveTextContent(item.sku);
      await expect(within(line).queryByRole("img")).toBeNull();
    }
  },
};
