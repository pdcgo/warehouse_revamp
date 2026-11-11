import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { formatRupiah } from "../../../lib/money";
import { ORDER_CREATE_META, pickProduct, typeQuantity } from "./kit";

// ORDER CREATE — the product lines: none to start, stock and HPP, a short line, two batches.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Lines",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The form starts EMPTY — no placeholder line. Lines arrive by picking products, so a blank row would
// be one you can neither remove nor use (#165). Create is what refuses an order with nothing on it.
export const StartsWithNoLinesAndCannotBeCreated: Story = {
  name: "Starts empty",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-lines-table")).toBeNull();
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// Picking reconciles the WHOLE ticked set into lines, and each line reads its stock and its HPP from
// the chosen warehouse — one batched read for all of them, not one per line.
export const PickingProductsAddsALineWithStockAndHpp: Story = {
  name: "Pick adds a line",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);

    await waitFor(() => expect(canvas.getByTestId("order-lines-table")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    // 40 on the shelf, from the fixtures — the figure is the warehouse's, not the catalogue's.
    await waitFor(() => expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("40"));
  },
};

// ⚠ THE RULE THIS PAGE EXISTS FOR. A line the warehouse cannot fill is summarised at the TOP as well
// as marked on the row, because on a long order the failing line is off screen — and "Create is
// disabled and I cannot see why" is the state this form must never be in.
export const AShortLineIsAnnouncedAtTheTopAndBlocksCreate: Story = {
  name: "Short line blocks",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Fixture product 72 has THREE on the shelf.
    await pickProduct(canvasElement, products[1]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-qty-0")).toBeInTheDocument());

    const qty = canvas.getByTestId("order-line-qty-0");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// ── WHAT LEAVES THE SHELF (an-order-is-costed-at-what-leaves-the-shelf) ─────────────────────────────────────────────

// A LINE IS COSTED AT THE BATCHES THE TAKE WOULD DRAW. Teh arrived twice — 1 at 8.000, then 2 at 9.500 — so one Teh
// costs 8.000, and two cost 1 × 8.000 + 1 × 9.500 = 17.500: the HPP reads 8.750 with the split under it, never the
// shelf's 9.000 average. Asked again of the warehouse as the quantity settles (StockTakeQuote).
export const ALineSpanningTwoBatchesShowsTheSplit: Story = {
  name: "Two batches, split",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[1]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-hpp-0")).toHaveTextContent(formatRupiah(8_000n)));
    await expect(canvas.queryByTestId("order-line-hpp-split-0")).toBeNull();

    await typeQuantity(canvasElement, 0, "2");

    await waitFor(() =>
      expect(canvas.getByTestId("order-line-hpp-split-0")).toHaveTextContent(
        `1 × ${formatRupiah(8_000n)} + 1 × ${formatRupiah(9_500n)}`,
      ),
    );
    await expect(canvas.getByTestId("order-line-hpp-0")).toHaveTextContent(formatRupiah(8_750n));
    await expect(canvas.getByTestId("order-line-total-0")).toHaveTextContent(formatRupiah(17_500n));
    await expect(canvas.getByTestId("order-create-products-total")).toHaveTextContent(formatRupiah(17_500n));
  },
};
