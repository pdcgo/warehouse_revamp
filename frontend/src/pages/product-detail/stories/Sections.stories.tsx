import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PRODUCT_DETAIL_META, loaded, openTab } from "./kit";

// PRODUCT DETAIL — one page of sections (the-product-page-is-one-page-of-sections): every one on the page and in the
// nav, nothing left marked, the tabs' rows, and a Batch row. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Sections",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** ONE PAGE OF SECTIONS (the-product-page-is-one-page-of-sections): every section is on the page, the nav names each,
 * and a click on one lights it. The warehouse card holds its four TABS, Overview open (the-warehouse-zone-is-tabs). */
export const EverySectionIsOnThePage: Story = {
  name: "Every section",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const key of ["info", "batch", "cross", "derived", "warehouse"]) {
      await expect(canvas.getByTestId(`pd-section-${key}`)).toBeInTheDocument();
      await expect(canvas.getByTestId(`section-nav-${key}`)).toBeInTheDocument();
    }
    // In this order (the-suppliers-are-a-tab-of-their-own): Harga Modal before Pemasok.
    const tabs = within(canvas.getByTestId("pd-warehouse-tabs")).getAllByRole("tab");
    await expect(tabs.map((tab) => tab.dataset.testid)).toEqual(
      ["overview", "price", "suppliers", "daily", "history"].map((key) => `pd-tab-${key}`),
    );
    await expect(canvas.getByTestId("pd-tab-overview")).toHaveAttribute("aria-selected", "true");

    await userEvent.click(canvas.getByTestId("section-nav-batch"));
    await waitFor(() => expect(canvas.getByTestId("section-nav-batch")).toHaveAttribute("aria-current", "location"));
    // The card it lands on blinks (a-nav-jump-blinks-where-it-lands), and stops.
    await waitFor(() => expect(canvas.getByTestId("pd-section-batch")).toHaveAttribute("data-flash"), { timeout: 2000 });
    await waitFor(() => expect(canvas.getByTestId("pd-section-batch")).not.toHaveAttribute("data-flash"), { timeout: 3000 });
  },
};

/** NOTHING IS MARKED ANY MORE — every gap the page once marked is real: Pemasok and Keluar Masuk Harian
 * (ProductSupplierGoods, ./Suppliers.stories.tsx; ProductDailyMoves, ./Daily.stories.tsx) and, since 2026-11-27, Produk
 * Turunan (the return maps, ./Derived.stories.tsx) — so the strip at the top is gone with its last mark. */
export const EveryGapIsMarked: Story = {
  name: "No gap left",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(within(canvas.getByTestId("pd-tab-suppliers")).queryByTestId("not-implemented-suppliers")).toBeNull();
    await expect(within(canvas.getByTestId("pd-section-derived")).queryByTestId("not-implemented-derived")).toBeNull();
    await expect(within(canvas.getByTestId("pd-tab-daily")).queryByTestId("not-implemented-daily")).toBeNull();
  },
};

/** THE TABS' ROWS wait for their own tab: the suppliers and the daily in and out, each read only once opened. (The
 * derived products, real since 2026-11-27, are ./Derived.stories.tsx.) */
export const SamplesFillTheGaps: Story = {
  name: "Tabs' rows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Pemasok is its own tab (the-suppliers-are-a-tab-of-their-own) — not in Overview, and only there once opened.
    await expect(canvas.queryByTestId("pd-supplier-row-0")).toBeNull();
    const suppliers = await openTab(canvas, "suppliers");
    await waitFor(() => expect(suppliers.getByTestId("pd-supplier-row-0")).toBeInTheDocument());

    const daily = await openTab(canvas, "daily");
    await waitFor(() => expect(daily.getAllByTestId(/^pd-daily-row-/)).toHaveLength(14));
  },
};

/** A delivery row lights up under the pointer, every cell (a-table-row-lights-up). */
export const ABatchRowLightsUp: Story = {
  name: "Batch row lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId("pd-batch-row-7001");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    row.removeAttribute("data-hover");
  },
};
