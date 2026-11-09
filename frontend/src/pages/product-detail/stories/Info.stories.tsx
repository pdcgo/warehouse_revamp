import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { stockStatus } from "../../../features/products/StockHighlight";
import type { OwnerStockRow } from "../../../features/products/adapt";
import { AtArchivedPack, AtTepung, PRODUCT_DETAIL_META, loaded, sectionOf } from "./kit";

// PRODUCT DETAIL — the Info section: the stock headline and its chip, the record itself, and Other teams' markup and
// lock. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Info",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE ONE THING THAT STANDS OUT (the-stock-headline-stands-out): how much is ready, large, beside the picture, with a
 * status chip — Minyak's 79 ready and young stock read Healthy; Tepung, with nothing on a shelf, reads Out of stock. */
export const TheStockHeadlineStandsOut: Story = {
  name: "Stock headline",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() => expect(info.getByTestId("pd-highlight-ready")).toHaveTextContent("79 pcs ready"));
    await expect(info.getByTestId("pd-stock-status")).toHaveAttribute("data-status", "ok");
    await expect(info.getByTestId("pd-highlight-line")).toHaveTextContent("+12 pcs on the way");
    // Siap and Dikirim lead in the highlight, so the list below it does not repeat them.
    await expect(info.queryByTestId("pd-total-ready")).toBeNull();
    await expect(info.queryByTestId("pd-total-ongoing")).toBeNull();
  },
};

/** THE CHIP'S RULES (the-stock-chip-says-how-much-is-left): 0 is Habis, under 5 is Hampir habis, 5 and up is Aman —
 * however old the stock, and whatever the lock. */
export const TheStockChipRules: Story = {
  name: "Chip rules",
  render: () => <p>See the assertions in this story's play function.</p>,
  play: async () => {
    const stock = (readyQty: bigint): OwnerStockRow => ({
      readyQty,
      readyValue: 0,
      ongoingQty: 0n,
      ongoingValueEst: 0,
      costMin: 0,
      costMax: 0,
      costKnown: false,
      oldestBatchUnix: 1n,
      lastRestockUnix: 0n,
    });

    await expect(stockStatus(undefined)).toBeUndefined();
    await expect(stockStatus(stock(0n))).toBe("out");
    await expect(stockStatus(stock(1n))).toBe("low");
    await expect(stockStatus(stock(4n))).toBe("low");
    await expect(stockStatus(stock(5n))).toBe("ok");
  },
};

export const OutOfStockReadsRed: Story = {
  name: "Out of stock",
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("pd-stock-status")).toHaveAttribute("data-status", "out"));
    await expect(canvas.getByTestId("pd-stock-status")).toHaveTextContent("Out of stock");
  },
};

/** Info is the record itself: the gallery opening on the cover, the SKU, the category, the description. A product with
 * no pictures says so instead of drawing an empty frame. */
export const InfoIsTheRecord: Story = {
  name: "The record",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(info.getByTestId("product-detail-images")).toBeVisible();
    await expect(info.getByTestId("product-detail-image-1")).toBeInTheDocument();
    // Aktivitas is two rows of Info now (owner: *"aktivitas masukkan ke info produk"*) — the last order (none yet) and
    // the last restock.
    await expect(info.getByTestId("product-detail-last-order")).toHaveTextContent("Never");
    await waitFor(() => expect(info.getByTestId("product-detail-last-restock")).not.toHaveTextContent("—"));
    await expect(canvas.queryByTestId("pd-section-activity")).toBeNull();
    await expect(canvas.getByTestId("pd-section-info")).toHaveTextContent("Minyak goreng kelapa sawit");
  },
};

/** OTHER TEAMS, beside the money: the markup as a percent, and the lock — one setting (one-lock-three-ways), a minimum
 * of 4 with the 79 ready well above it, so no badge. */
export const OtherTeamsHoldTheMarkupAndTheLock: Story = {
  name: "Markup and lock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const cross = await sectionOf(canvas, "cross");

    await expect(cross.getByTestId("product-detail-markup")).toHaveTextContent("12.5%");
    await expect(cross.getByTestId("product-detail-lock")).toHaveTextContent("Min 4 pcs");
    await expect(canvas.queryByTestId("product-detail-lock-control-now")).toBeNull();
  },
};

export const AProductWithNoPictures: Story = {
  name: "No pictures",
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-no-images")).toBeVisible();
  },
};
