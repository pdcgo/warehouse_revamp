import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — what a row shows: its dates under its stock, the cost range and the cross price under it, the SKU that
// copies — and the heading that sorts, and the row lighting up. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Rows",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The dates read as AGES (the-dates-read-as-ages), and each rides under the stock it dates
 * (each-date-rides-under-its-stock): when it was last ordered under Reserved, when stock last arrived under Ongoing; only
 * the stock's age, in days, keeps a column. Old stock is in the warning tone.
 *
 * Only what holds on any later day is asserted: an age grows, so SKU-ANG-020 (its oldest units in since 20 Aug) is past
 * the 60 days now and stays past them. */
export const TheDatesRideUnderTheirStock: Story = {
  name: "Dates under their stock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const header = within(canvas.getByTestId("products-table")).getAllByRole("row")[0]!;

    await expect(header).toHaveTextContent("Stock age");
    await expect(header).not.toHaveTextContent("Last restock");
    await expect(header).not.toHaveTextContent("Last order");
    await expect(header).not.toHaveTextContent("Oldest batch");
    await expect(header).not.toHaveTextContent("Reserved");

    await waitFor(() => expect(canvas.getByTestId("stock-age-SKU-ANG-001")).toHaveTextContent(/^\d+ days?$/));
    await expect(canvas.getByTestId("stock-age-SKU-ANG-020").firstElementChild).toHaveAttribute("data-stale", "true");

    // Under Reserved, its last order — or that it has none; under Ongoing, its last restock. As DATES, never "… ago"
    // (a-row-date-reads-as-a-date); only the stock's age is in days.
    const row = canvas.getByTestId("product-row-SKU-ANG-002");
    // The line is the date alone; what it is, is its tooltip (a-second-line-names-itself-in-a-tooltip).
    await expect(within(row).getByTestId("last-order-SKU-ANG-002")).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await expect(within(row).getByTestId("last-restock-SKU-ANG-002")).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await expect(row).not.toHaveTextContent("ago");
    await expect(canvas.getByTestId("last-order-SKU-ANG-001")).toHaveTextContent("No order yet");

    await userEvent.hover(within(row).getByTestId("last-restock-SKU-ANG-002"));
    const hint = await screen.findByTestId("last-restock-SKU-ANG-002-hint");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(hint).toHaveTextContent("Last restock");
  },
};

/** A cost range reads as ONE range — both ends on a line, the dash between (a-cost-range-reads-as-a-range); a product that
 * came in one delivery has one price; nothing on a shelf has none. */
export const TheCostRangeReadsAsARange: Story = {
  name: "Cost range",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // Product, Cross, then the cost (the-cross-price-rides-under-the-markup).
    const costOf = (sku: string) => within(canvas.getByTestId(`product-row-${sku}`)).getAllByRole("cell")[2]!;

    // The cost is the cell's first line; the cross price is the line under it.
    const rangeOf = (sku: string) => costOf(sku).querySelector("p")!;
    await waitFor(() => expect(rangeOf("SKU-ANG-001")).toHaveTextContent(/^Rp 45\.700 – Rp 47\.200$/));
    // SKU-ANG-006 came in one delivery — one price, no dash.
    await expect(rangeOf("SKU-ANG-006")).toHaveTextContent(/^Rp [\d.]+$/);
    await expect(costOf("SKU-ANG-003")).toHaveTextContent(/^—$/);
  },
};

/** CROSS COMES BEFORE THE COST, and UNDER THE COST what another team pays (the-cross-price-rides-under-the-cost) — the
 * cost range with the markup on both ends, said "Cross …". 700 costs Rp 45.700 – Rp 47.200 at 12.5%; a 0% product's price
 * is its cost; nothing on a shelf has neither. The lock follows the cost. */
export const TheCrossPriceRidesUnderTheCost: Story = {
  name: "Cross price under the cost",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headings = within(within(canvas.getByTestId("products-table")).getAllByRole("row")[0]!)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());

    await expect(headings.indexOf("Cost range")).toBe(headings.indexOf("Cross") + 1);
    await expect(headings.indexOf("Lock")).toBe(headings.indexOf("Cost range") + 1);

    await expect(canvas.getByTestId("cross-SKU-ANG-001")).toHaveTextContent(/^12\.5%$/);

    // The cross price sits in the COST's cell, under the range.
    const costCell = within(canvas.getByTestId("product-row-SKU-ANG-001")).getAllByRole("cell")[2]!;
    await waitFor(() =>
      expect(within(costCell).getByTestId("cross-price-SKU-ANG-001")).toHaveTextContent(/^Rp 51\.412 – Rp 53\.100$/),
    );
    await expect(canvas.getByTestId("cross-price-SKU-ANG-006")).toHaveTextContent(/^Rp 10\.255$/);
    await expect(canvas.queryByTestId("cross-price-SKU-ANG-003")).toBeNull();

    // The line names itself on hover, not in its text (a-second-line-names-itself-in-a-tooltip).
    await userEvent.hover(canvas.getByTestId("cross-price-SKU-ANG-001"));
    const hint = await screen.findByTestId("cross-price-SKU-ANG-001-hint");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(hint).toHaveTextContent("Cross price");
  },
};

/** The SKU copies on a click — and the click does not open the row it sits on. */
export const TheSkuCopiesWithoutOpeningTheRow: Story = {
  name: "SKU copies",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const sku = within(canvas.getByTestId("product-row-SKU-ANG-001")).getByTestId("product-list-item-sku-700");

    await expect(sku).toHaveAccessibleName(/SKU-ANG-001/);
    await userEvent.click(sku);
    await waitFor(() => expect(sku.hasAttribute("data-copied") || sku.hasAttribute("data-copy-failed")).toBe(true));
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();
  },
};

/** The product heading sorts by name — A to Z first, then flipped; the server sorts, and the URL keeps it. */
export const TheHeadingSortsByName: Story = {
  name: "Sort by name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const firstRow = () => within(canvas.getByTestId("products-table")).getAllByRole("row")[1]!;

    await userEvent.click(canvas.getByTestId("product-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Air Mineral Galon 19L — Karton"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("sort=name"));

    await userEvent.click(canvas.getByTestId("product-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Tisu Wajah Kotak 250 lembar — Satuan"));
  },
};

/** A row lights up under the pointer, every cell (a-table-row-lights-up) — and the whole row opens the product. */
export const TheWholeRowLightsUp: Story = {
  name: "Lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId("product-row-SKU-ANG-001");
    const cells = within(row).getAllByRole("cell");

    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    row.removeAttribute("data-hover");
  },
};
