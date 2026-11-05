import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PRODUCT_DETAIL_META, loaded, openTab, sectionOf } from "./kit";

// PRODUCT DETAIL — one page of sections (the-product-page-is-one-page-of-sections): every one on the page and in the
// nav, what cannot be shown yet marked, the sample rows, and a Batch row. The page's stories are grouped by the part of
// the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

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

/** WHAT THE PAGE CANNOT SHOW YET is marked where it would be — the Pemasok tab, Derived products, the Daily tab —
 * and listed in the strip at the top. */
export const EveryGapIsMarked: Story = {
  name: "Gaps marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("pd-tab-suppliers")).getByTestId("not-implemented-suppliers")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("pd-section-derived")).getByTestId("not-implemented-derived")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("pd-tab-daily")).getByTestId("not-implemented-daily")).toBeInTheDocument();
  },
};

/** SAMPLE ROWS, each part with its ⚠: the suppliers and the daily in and out under their tabs, and the derived
 * products — MANY, so the card holds the count and the first three as one line each, and "See all" opens the whole
 * list (owner: *"dia bisa banyak … kalau kepanjangan membingungkan"*). */
export const SamplesFillTheGaps: Story = {
  name: "Samples",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Pemasok is its own tab (the-suppliers-are-a-tab-of-their-own) — not in Overview, and only there once opened.
    await expect(canvas.queryByTestId("pd-supplier-row-0")).toBeNull();
    const suppliers = await openTab(canvas, "suppliers");
    await waitFor(() => expect(suppliers.getByTestId("pd-supplier-row-0")).toBeInTheDocument());

    const derived = await sectionOf(canvas, "derived");
    await expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent("Toko Kenanga");
    const count = Number(derived.getByTestId("pd-derived-count").textContent);
    await expect(count).toBeGreaterThan(3);
    await expect(derived.getByTestId("pd-derived-to-2")).toBeInTheDocument();
    // A line reads "N pcs" — the derived product's READY stock, said by its tooltip — and carries no date.
    await expect(derived.getByTestId("pd-derived-to-0-pcs")).toHaveTextContent(/^\d+ pcs$/);
    await expect(derived.getByTestId("pd-derived-to-0-pcs")).toHaveAttribute("aria-label", expect.stringMatching(/pcs ready/));
    await expect(derived.queryByTestId("pd-derived-to-3")).toBeNull();

    await userEvent.click(derived.getByTestId("pd-derived-see-all"));
    const dialog = await screen.findByTestId("pd-derived-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getAllByTestId(/^pd-derived-row-/)).toHaveLength(count);
    // Each with its picture (owner: *"produk turunan di modal ada gambarnya"*).
    await expect(within(dialog).getByTestId("pd-derived-image-0")).toBeVisible();
    await userEvent.keyboard("{Escape}");

    const daily = await openTab(canvas, "daily");
    await expect(daily.getAllByTestId(/^pd-daily-row-/)).toHaveLength(14);
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
