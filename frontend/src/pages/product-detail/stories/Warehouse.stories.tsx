import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { AtTepung, PRODUCT_DETAIL_META, loaded, openTab } from "./kit";

// PRODUCT DETAIL — the warehouse zone (the-warehouse-picker-splits-the-page): the picker, and the card's tabs under it —
// Overview, Harga Modal, Riwayat Stok — each loaded only when opened. The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Warehouse",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE FIGURES, TWICE: in Info the product's total across every warehouse, and under the picker that warehouse's — the
 * same while the picker reads every warehouse: 79 ready, the cost range, the cross price under it. */
export const TheFiguresTwice: Story = {
  name: "Figures twice",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pd-highlight-ready")).toHaveTextContent("79 pcs"));
    // The Overview is small details (the-overview-is-small-details) — no big figure, no chip; those are Info's alone.
    await expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("79 pcs");
    await expect(canvas.queryByTestId("pd-overview-status")).toBeNull();
    await expect(canvas.queryByTestId("pd-overview-ready")).toBeNull();
    await expect(canvas.getByTestId("pd-overview-row-cost")).toHaveTextContent("Rp 45.700 – Rp 47.200");
    await expect(canvas.getByTestId("pd-overview-row-age")).toHaveTextContent(/day/);
  },
};

/** THE PICKER SPLITS THE PAGE (the-warehouse-picker-splits-the-page): choosing Gudang Cabang restates the overview
 * under it — 25 ready — while Info's total stays 79 and Batch, which is every warehouse, keeps all three deliveries.
 * One picker on the page, the note saying the figures below are one warehouse's. */
export const ThePickerSplitsThePage: Story = {
  name: "Picker splits the page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pd-batch-row-7001")).toBeInTheDocument());
    const rows = () => within(canvas.getByTestId("pd-batch-table")).getAllByTestId(/^pd-batch-row-/);
    await expect(rows().map((r) => r.dataset.testid)).toEqual(["pd-batch-row-7003", "pd-batch-row-7002", "pd-batch-row-7001"]);
    await expect(canvas.queryAllByTestId(/-warehouse-filter$/)).toHaveLength(1);
    // Three deliveries fit page 1, so there is no pager (a-short-section-hides-its-pager).
    await expect(canvas.queryByTestId("pd-batch-pager")).toBeNull();

    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("25 pcs"));
    await expect(canvas.getByTestId("pd-warehouse-note")).toBeVisible();
    await expect(canvas.getByTestId("pd-highlight-ready")).toHaveTextContent("79 pcs");
    await expect(rows()).toHaveLength(3);
  },
};

/** ONLY THE OPEN TAB LOADS (owner: *"yang pergudang jadikan per tab biar ga load semuanya"*): the cost layers are not on
 * the page until Harga Modal is opened, and opening it lets Overview go. */
export const TheWarehouseTabsLoadOnlyWhenOpened: Story = {
  name: "Tabs load when opened",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pd-panel-overview")).toBeVisible());
    await expect(canvas.queryByTestId("pd-price-table")).toBeNull();
    await expect(canvas.queryByTestId("pd-history-table")).toBeNull();

    const price = await openTab(canvas, "price");
    await waitFor(() => expect(price.getByTestId("pd-price-row-0")).toBeInTheDocument());
    await waitFor(() => expect(canvas.queryByTestId("pd-overview")).toBeNull());
  },
};

/** Price lists the cost layers still holding stock — one per delivery — and values them together. */
export const PriceListsTheLayers: Story = {
  name: "Cost layers",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "price");

    await waitFor(() => expect(canvas.getByTestId("pd-price-row-2")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pd-price-row-3")).toBeNull();
    await expect(canvas.getByTestId("pd-price-total")).toHaveTextContent("3.667.000");
    // Three layers fit page 1, so there is no pager (a-short-section-hides-its-pager).
    await expect(canvas.queryByTestId("pd-price-pager")).toBeNull();
  },
};

/** Stock history lists every receipt and pick, newest first — five movements ending on the 79 ready. */
export const StockHistoryListsEveryMovement: Story = {
  name: "Stock history",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "history");

    await waitFor(() => expect(canvas.getByTestId("pd-history-row-70005")).toBeInTheDocument());
    const rows = within(canvas.getByTestId("pd-history-table")).getAllByTestId(/^pd-history-row-/);
    await expect(rows).toHaveLength(5);
    await expect(rows[0]!.dataset.testid).toBe("pd-history-row-70005");
    // Five movements fit page 1, so there is no pager (no-list-on-the-product-page-pages-when-it-fits).
    await expect(canvas.queryByTestId("pd-history-pager")).toBeNull();
  },
};

/** A product with nothing on a shelf says why in every section — the empty hint, never a bare grey line
 * (an-empty-list-shows-a-hint). */
export const NothingOnAShelfSaysWhy: Story = {
  name: "Nothing on a shelf",
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("pd-batch-empty", {}, { timeout: 4000 })).toHaveTextContent("once a restock of this product");
    await openTab(canvas, "price");
    await expect(await canvas.findByTestId("pd-price-empty")).toHaveTextContent("No stock on a shelf");
    await openTab(canvas, "history");
    await expect(await canvas.findByTestId("pd-history-empty")).toHaveTextContent("Nothing has moved yet.");
  },
};

/** ON A PHONE, HARGA MODAL AND RIWAYAT STOK ARE LINES, not tables (a-phone-reads-each-line-as-a-block; owner: *"harga
 * modal di mobile masih berantakan, riwayat stok kepotong"*): a layer is its arithmetic — *Rp 45.700 × 30 pcs … Rp
 * 1.371.000*, the cross price under it — and a movement is two lines with the change and what was left on the right.
 * Neither pushes the page wider than the screen. */
export const APhoneReadsTheTabsAsLines: Story = {
  name: "Phone · tabs as lines",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const fitsTheScreen = () =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    const price = await openTab(canvas, "price");
    await waitFor(() => expect(price.getByTestId("pd-price-row-0")).toBeInTheDocument());
    await expect(price.queryByRole("table")).toBeNull();
    await expect(price.getByTestId("pd-price-row-0")).toHaveTextContent(/Rp\s?45\.700\s?× 30 pcs.*Rp\s?1\.371\.000/);
    await expect(price.getByTestId("pd-price-row-0")).toHaveTextContent(/Cross Rp\s?51\.412/);
    fitsTheScreen();

    const history = await openTab(canvas, "history");
    await waitFor(() => expect(history.getByTestId("pd-history-row-70005")).toBeInTheDocument());
    await expect(history.queryByRole("table")).toBeNull();
    await expect(history.getByTestId("pd-history-row-70005")).toHaveTextContent(/\+24/);
    await expect(history.getByTestId("pd-history-row-70005")).toHaveTextContent(/After, in that warehouse 79/);
    fitsTheScreen();
  },
};
