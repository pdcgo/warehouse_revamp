import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { AtBeras, DISCOVER_PRODUCT_DETAIL_META, GULA, loaded, routedAt, sectionOf } from "./kit";

// DISCOVER PRODUCT DETAIL — the title row and the page's shape (the-discover-detail-is-the-product-page): its sections
// and tabs, the way to your own product's page, Back, and an id that is not found. The page's stories are grouped by the
// part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Header",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE OWNER'S PAGE'S SHAPE: back as an icon beside the name, the SKU under it, a nav beside one page of sections — Info,
// Penjualan Tim Lain, Produk Turunan, Harga per Gudang, Per Gudang — and the large ready figure leading Info. Per Gudang is
// the owner's page's warehouse card WITHOUT Harga Modal; Harga per Gudang stands above it in its stead
// (the-discover-detail-has-the-warehouse-zone).
export const TheOwnersPageShape: Story = {
  name: "The owner's page's shape",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent(GULA.name);
    await expect(canvas.getByTestId("discover-detail-sku")).toHaveTextContent(GULA.productCode);
    await expect(canvas.getByTestId("discover-detail-back")).toHaveAccessibleName("Back to Discover Products");
    // The same row in small waits in the sticky bar, hidden while the title is on screen (useStickyTitle — the owner's
    // page's stories scroll it into view).
    await expect(canvas.getByTestId("discover-detail-name-bar")).not.toHaveAttribute("data-shown");

    for (const key of ["info", "derived", "price", "warehouse"] as const) {
      await expect(canvas.getByTestId(`dd-section-${key}`)).toBeInTheDocument();
    }
    // No Penjualan Tim Lain card: the lock is the title's badge (the-lock-is-the-title-badge).
    await expect(canvas.queryByTestId("dd-section-cross")).toBeNull();
    await expect(canvas.queryByTestId("dd-section-suppliers")).toBeNull();

    // The warehouse card's tabs, in the owner's page's order, with no Harga Modal.
    await expect(
      within(canvas.getByTestId("dd-warehouse-tabs"))
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("data-testid")),
    ).toEqual(["overview", "suppliers", "daily", "history"].map((key) => `dd-tab-${key}`));
    await expect(canvas.getByTestId("dd-warehouse-filter")).toBeInTheDocument();

    const info = await sectionOf(canvas, "info");
    await expect(info.getByTestId("discover-detail-highlight")).toBeInTheDocument();
  },
};

// Discovery lists your own products too; opening one offers the way to the owner's page — the title row's action —
// which has the cost story and the controls this one deliberately lacks. Its own cost shows, as on its card.
export const YourOwnProductPointsHome: Story = {
  name: "Own product, to its page",
  render: () => <AtBeras />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(info.getByTestId("discover-detail-cost")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("discover-detail-open-own"));
    await canvas.findByTestId("at-own-product");
  },
};

export const BackGoesToDiscover: Story = {
  name: "Back to Discover",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

const AtNothing = routedAt(999n);

// ProductByIds omits an id it cannot resolve rather than failing, so "not found" is the page's own call.
export const AnUnknownIdIsNotFound: Story = {
  name: "Unknown id, not found",
  render: () => <AtNothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("discover-detail-error")).toHaveTextContent("Product not found.");
  },
};
