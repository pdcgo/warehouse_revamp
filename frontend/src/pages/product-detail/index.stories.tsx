import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, markerWithSearch, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductDetailPage } from "./index";
import { stockStatus } from "../../features/products/StockHighlight";
import type { OwnerStockRow } from "../../features/products/adapt";

// A PRODUCT'S PAGE, IN THE ORDER DETAIL'S SHAPE (the-product-page-is-one-page-of-sections): a title row (back, the name
// with its SKU, the actions) that the sticky bar repeats in small, a navigation beside one page of sections in TWO ZONES
// (the-warehouse-picker-splits-the-page) — every warehouse above (Info with the total figures, Batch, Other teams,
// Activity, Derived ⚠), and the warehouse card below with its TABS (the-warehouse-zone-is-tabs): Overview (its figures,
// Suppliers ⚠), Cost price, Daily ⚠, Stock history. The stub is productStub.ts, its figures consistent across them:
//
//   700  SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan   (Toko Anggrek, team 15)
//        info        two pictures, a description, 12.5% markup, 4 held back
//        batch 7001  Gudang Pusat   ready 30 of 60  @ Rp 45.700
//        batch 7002  Gudang Cabang  ready 25 of 40  @ Rp 47.200
//        batch 7003  Gudang Pusat   ready 24 of 24  @ Rp 46.500     → 79 ready, Rp 3.667.000
//        history     receive 60, pick 30, receive 40, pick 15, receive 24 → balance 79
//   790  SKU-ANG-001  the archived older pack — its SKU now held by 700
//    74  another team's product — not found here

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products/:productId", element: <ProductDetailPage /> },
  marker("/products", "at-products"),
  marker("/products/archived", "at-products-archive"),
  marker("/products/:productId/edit", "at-product-edit"),
  // The two forms the page opens with this product on them (a-product-page-opens-the-order-and-restock-forms).
  markerWithSearch("/orders/new", "at-order-form"),
  markerWithSearch("/inventories/restock/new", "at-restock-form"),
];
const At = (productId: number) => routedPage(routes, `/products/${productId}`);
const AtMinyak = At(700);
const AtTepung = At(702);
const AtArchivedPack = At(790);
const AtOtherTeams = At(74);

const meta = {
  title: "Pages/Products/ProductDetail",
  component: AtMinyak,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
} satisfies Meta<typeof AtMinyak>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-detail-page", {}, { timeout: 5000 });
  return canvas;
}

/** A section, found by its card — every section is on the page at once. */
async function sectionOf(canvas: ReturnType<typeof within>, key: "info" | "batch" | "cross" | "derived" | "warehouse") {
  return within(await canvas.findByTestId(`pd-section-${key}`));
}

/** Open one of the warehouse card's tabs — only the open one is mounted (the-warehouse-zone-is-tabs). */
async function openTab(canvas: ReturnType<typeof within>, key: "overview" | "suppliers" | "price" | "daily" | "history") {
  await userEvent.click(await canvas.findByTestId(`pd-tab-${key}`));
  await waitFor(() => expect(canvas.getByTestId(`pd-panel-${key}`)).toBeVisible());
  return within(canvas.getByTestId(`pd-panel-${key}`));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — one row of header with the actions in ⋯ and the section chips under it, the sections in one column. */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
  },
};

/** An archived product — reachable by URL, so the page says so and offers Restore instead of Edit. */
export const AnArchivedProduct: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-detail-archived")).toBeVisible();
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
    await expect(canvas.queryByTestId("product-detail-edit")).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The product's name is the title ABOVE the Info card, its SKU to copy under it; inside Info the category leads the
 * record's list, read like the figures under it. */
export const TheProductsName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent(/^Minyak Goreng Sawit 2L — Satuan$/);
    await expect(info.queryByTestId("product-detail-name")).toBeNull();
    await expect(canvas.getByTestId("product-detail-sku")).toHaveTextContent("SKU-ANG-001");
    await expect(info.queryByTestId("product-detail-sku")).toBeNull();
    await waitFor(() => expect(info.getByTestId("product-detail-category")).toHaveTextContent("Rumah Tangga"));
  },
};

/** ONE PAGE OF SECTIONS (the-product-page-is-one-page-of-sections): every section is on the page, the nav names each,
 * and a click on one lights it. The warehouse card holds its four TABS, Overview open (the-warehouse-zone-is-tabs). */
export const EverySectionIsOnThePage: Story = {
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

/** ONLY THE OPEN TAB LOADS (owner: *"yang pergudang jadikan per tab biar ga load semuanya"*): the cost layers are not on
 * the page until Harga Modal is opened, and opening it lets Overview go. */
export const TheWarehouseTabsLoadOnlyWhenOpened: Story = {
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

/** WHAT THE PAGE CANNOT SHOW YET is marked where it would be — the Pemasok tab, Derived products, the Daily tab —
 * and listed in the strip at the top. */
export const EveryGapIsMarked: Story = {
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

/** THE HEADER ROW — back as an icon beside the name, the SKU under it, the actions on the right — and the SAME ROW in
 * the sticky bar, which shows only once the title has scrolled behind it (it showed from the start once: owner,
 * *"stickymu bermasalah, muncul terus"*). */
export const TheHeaderRowSticks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("product-detail-name-bar");

    // The page's own row: back beside the name, the actions on it.
    await expect(canvas.getByTestId("product-detail-back")).toBeInTheDocument();
    await expect(canvas.getByTestId("product-detail-edit")).toBeInTheDocument();
    await expect(bar).not.toHaveAttribute("data-shown");
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).not.toHaveAttribute("data-shown");

    canvas.getByTestId("pd-section-warehouse").scrollIntoView();
    await waitFor(() => expect(bar).toHaveAttribute("data-shown", "true"));
    await expect(bar).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
    // The SKU, back and the actions ride with it (owner: *"di stickynya juga ada skuid"*, *"di stickynya juga ada"*).
    await expect(within(bar).getByTestId("product-detail-sticky-sku")).toHaveTextContent("SKU-ANG-001");
    await expect(within(bar).getByTestId("product-detail-sticky-back")).toBeInTheDocument();
    await expect(within(bar).getByTestId("product-detail-sticky-edit")).toBeInTheDocument();

    // Back up and down again — it follows the name each way, and holds still in between (it flipped back and forth
    // while the page sat still before: owner, *"judul stickynya ngebug di bolak balik"*).
    window.scrollTo(0, 0);
    await waitFor(() => expect(bar).not.toHaveAttribute("data-shown"));
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).not.toHaveAttribute("data-shown");
    canvas.getByTestId("pd-section-warehouse").scrollIntoView();
    await waitFor(() => expect(bar).toHaveAttribute("data-shown", "true"));
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).toHaveAttribute("data-shown", "true");
    window.scrollTo(0, 0);
  },
};

/** THE ONE THING THAT STANDS OUT (the-stock-headline-stands-out): how much is ready, large, beside the picture, with a
 * status chip — Minyak's 79 ready and young stock read Healthy; Tepung, with nothing on a shelf, reads Out of stock. */
export const TheStockHeadlineStandsOut: Story = {
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
  render: () => <p>See the assertions in this story's play function.</p>,
  play: async () => {
    const stock = (readyQty: bigint): OwnerStockRow => ({
      readyQty,
      readyValue: 0n,
      ongoingQty: 0n,
      ongoingValueEst: 0n,
      costMin: 0n,
      costMax: 0n,
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
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("pd-stock-status")).toHaveAttribute("data-status", "out"));
    await expect(canvas.getByTestId("pd-stock-status")).toHaveTextContent("Out of stock");
  },
};

/** THE FIGURES, TWICE: in Info the product's total across every warehouse, and under the picker that warehouse's — the
 * same while the picker reads every warehouse: 79 ready, the cost range, the cross price under it. */
export const TheFiguresTwice: Story = {
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

/** Info is the record itself: the gallery opening on the cover, the SKU, the category, the description. A product with
 * no pictures says so instead of drawing an empty frame. */
export const InfoIsTheRecord: Story = {
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
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const cross = await sectionOf(canvas, "cross");

    await expect(cross.getByTestId("product-detail-markup")).toHaveTextContent("12.5%");
    await expect(cross.getByTestId("product-detail-lock")).toHaveTextContent("Min 4 pcs");
    await expect(canvas.queryByTestId("product-detail-lock-control-now")).toBeNull();
  },
};

export const AProductWithNoPictures: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-no-images")).toBeVisible();
  },
};

/** Price lists the cost layers still holding stock — one per delivery — and values them together. */
export const PriceListsTheLayers: Story = {
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

/** ON A PHONE, HARGA MODAL AND RIWAYAT STOK ARE LINES, not tables (a-phone-reads-each-line-as-a-block; owner: *"harga
 * modal di mobile masih berantakan, riwayat stok kepotong"*): a layer is its arithmetic — *Rp 45.700 × 30 pcs … Rp
 * 1.371.000*, the cross price under it — and a movement is two lines with the change and what was left on the right.
 * Neither pushes the page wider than the screen. */
export const APhoneReadsTheTabsAsLines: Story = {
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

/** THE PICKER SPLITS THE PAGE (the-warehouse-picker-splits-the-page): choosing Gudang Cabang restates the overview
 * under it — 25 ready — while Info's total stays 79 and Batch, which is every warehouse, keeps all three deliveries.
 * One picker on the page, the note saying the figures below are one warehouse's. */
export const ThePickerSplitsThePage: Story = {
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

/** A delivery row lights up under the pointer, every cell (a-table-row-lights-up). */
export const ABatchRowLightsUp: Story = {
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

/** A product with nothing on a shelf says why in every section — the empty hint, never a bare grey line
 * (an-empty-list-shows-a-hint). */
export const NothingOnAShelfSaysWhy: Story = {
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

/** Stock history lists every receipt and pick, newest first — five movements ending on the 79 ready. */
export const StockHistoryListsEveryMovement: Story = {
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

/** Archive confirms first, naming the SKU — and the page then says the product is archived. */
export const ArchiveConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SKU-ANG-001");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("product-detail-archived")).toBeVisible());
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
  },
};

/** Restoring the older pack collides — its SKU is now SKU-ANG-001's live product — and restores under a new one. */
export const RestoreCollidesAndAsksForANewSku: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-restore"));
    const dialog = await screen.findByTestId("restore-conflict-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.type(within(dialog).getByTestId("restore-new-sku"), "SKU-ANG-001-L", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restore-with-new-sku"));

    await waitFor(() => expect(canvas.queryByTestId("product-detail-archived")).toBeNull());
    await expect(canvas.getByTestId("product-detail-page")).toHaveTextContent("SKU-ANG-001-L");
  },
};

/** Edit opens the product's form; Back returns to the list. */
export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-edit"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

export const BackGoesToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

/** An archived product's Back returns to the archive it was opened from (the-archive-is-a-page-of-its-own). */
export const AnArchivedProductGoesBackToTheArchive: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products-archive")).toBeInTheDocument());
  },
};

/** Another team's product is not found — the id in the URL is not trusted to belong to the team in hand. */
export const AnotherTeamsProductIsNotFound: Story = {
  render: () => <AtOtherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("product-detail-error", {}, { timeout: 5000 })).toBeVisible();
  },
};

// ORDER AND RESTOCK FROM HERE — the warehouse and the quantity first, on the page (the-order-and-restock-start-on-the-page):
// every warehouse with its ready stock, the fullest preselected; then the form, with this product on it at that quantity
// (a-product-page-opens-the-order-and-restock-forms).
export const OrderAndRestockOpenTheirForms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-order"));
    const dialog = await screen.findByTestId("start-order-dialog");
    // Minyak: 54 ready at Gudang Pusat, 25 at Gudang Cabang — Pusat, the fullest, is preselected.
    await waitFor(() => expect(within(dialog).getByTestId("start-warehouse-ready-11")).toHaveTextContent("54 pcs"));
    await expect(within(dialog).getByTestId("start-warehouse-ready-14")).toHaveTextContent("25 pcs");

    const qty = within(dialog).getByTestId("start-quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "2", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("start-order-continue"));

    await canvas.findByTestId("at-order-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?product=700&warehouse=11&qty=2");
  },
};

export const RestockOpensWithThePickedWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The page's reads land first — the picker's warehouses among them — as ThePickerSplitsThePage waits.
    await waitFor(() => expect(canvas.getByTestId("pd-batch-row-7001")).toBeInTheDocument());
    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("pd-warehouse-note")).toBeVisible());
    await userEvent.click(canvas.getByTestId("product-detail-restock"));
    const dialog = await screen.findByTestId("start-restock-dialog");
    // The lens's warehouse comes preselected.
    await waitFor(() => expect(within(dialog).getByTestId("start-restock-continue")).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId("start-restock-continue"));

    await canvas.findByTestId("at-restock-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?product=700&warehouse=14&qty=1");
  },
};

// NOTHING READY ANYWHERE, NOTHING TO ORDER (an-empty-product-cannot-start-an-order) — Tepung has no stock on any shelf:
// Buat Pesanan is held back with the reason, while Restok, the way stock comes back, stays.
export const OrderIsHeldBackWithNoStock: Story = {
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("product-detail-order")).toBeDisabled());
    await expect(canvas.getByTestId("product-detail-order").parentElement).toHaveAttribute(
      "title",
      "No stock is ready in any warehouse.",
    );
    await expect(canvas.getByTestId("product-detail-restock")).toBeEnabled();
  },
};
