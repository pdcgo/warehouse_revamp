import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "./index";

// THE PRODUCTS LIST — a selling team's catalogue: the stat row, the search and the warehouse lens, a row per product
// with its stock, cost and sales figures, the lock in the row, Edit and Archive — and the ARCHIVE, a page of its own
// opened from the header's Arsip button (the-archive-is-a-page-of-its-own), each row there offering Restore. The stub is
// productStub.ts, writeable, with the server's rules — a SKU once among the live, archive is soft, restore can collide.
//
// Toko Anggrek (team 15) holds 44 live products with invented but consistent figures:
//
//   SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan     79 ready (30 + 24 in Gudang Pusat, 25 in Gudang Cabang)
//   SKU-ANG-003  Tepung Terigu Serbaguna 1kg — Satuan nothing on a shelf
//   archived:    SKU-ANG-001 (an older pack — its SKU now taken by the live one), SKU-ANG-LAMA

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe /></> },
  { path: "/products/archived", element: <><ProductsPage archived /><LocationProbe /></> },
  marker("/products/new", "at-product-new"),
  marker("/products/:productId", "at-product-detail"),
  marker("/products/:productId/edit", "at-product-edit"),
];
const At = (path: string) => routedPage(routes, path);
const AtProducts = At("/products");

const meta = {
  title: "Pages/Products/Products",
  component: AtProducts,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
} satisfies Meta<typeof AtProducts>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-row-SKU-ANG-001", {}, { timeout: 5000 });
  return canvas;
}

/** Into the archive — its own page, from the header's Arsip button. */
async function openArchived(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("open-archived-products"));
  await canvas.findByTestId("products-archive-page");
  await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible());
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — the same table, as the screen stands today (it has no phone arrangement of its own yet). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("open-create-product")).toBeVisible();
  },
};

/** The archive — its own page, the archived products alone. */
export const Archived: Story = {
  render: () => <AtArchived />,
};
const AtArchived = At("/products/archived");

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The stat row counts the live catalogue and adds up its stock; each row carries its own figures — a product with
 * nothing on a shelf reads 0 pcs, a stock read that answered, not an unknown. */
export const TheCatalogueAndItsFigures: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("products-total-value")).toHaveTextContent(/^44$/));
    await waitFor(() => expect(canvas.getByTestId("products-ready-stock")).toHaveTextContent("pcs"));
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("79 pcs"));
    await expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
    await expect(canvas.getByTestId("product-row-SKU-ANG-003")).toHaveTextContent("0 pcs");
  },
};

/** The warehouse lens restates every stock figure for that one building — the catalogue itself does not shrink. */
export const TheWarehouseLensRestatesTheStock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("79 pcs"));

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("25 pcs"));
    await expect(canvas.getByTestId("products-total-value")).toHaveTextContent(/^44$/);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("warehouse=14"));
  },
};

/** The page names itself — there is no top bar over it any more (the-desktop-shell-has-no-top-bar) — and New Product
 * carries its ＋ (an-action-button-carries-its-icon). */
export const ThePageNamesItself: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(canvas.getByTestId("products-page")).toHaveTextContent("Toko Anggrek");
    await expect(canvas.getByTestId("open-create-product").querySelector("svg")).not.toBeNull();
  },
};

/** The figures are the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — grey cards, each a
 * label, one figure and a quiet line. */
export const TheFiguresAreTheCardStrip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const strip = canvas.getByTestId("products-stats");

    await expect(within(strip).getAllByTestId(/^products-[a-z-]+-value$/)).toHaveLength(5);
    await waitFor(() => expect(canvas.getByTestId("products-ready-stock")).toHaveTextContent("at cost"));
  },
};

/** The dates read as AGES (the-dates-read-as-ages), and each rides under the stock it dates
 * (each-date-rides-under-its-stock): when it was last ordered under Reserved, when stock last arrived under Ongoing; only
 * the stock's age, in days, keeps a column. Old stock is in the warning tone.
 *
 * Only what holds on any later day is asserted: an age grows, so SKU-ANG-020 (its oldest units in since 20 Aug) is past
 * the 60 days now and stays past them. */
export const TheDatesRideUnderTheirStock: Story = {
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
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const sku = within(canvas.getByTestId("product-row-SKU-ANG-001")).getByTestId("product-list-item-sku-700");

    await expect(sku).toHaveAccessibleName(/SKU-ANG-001/);
    await userEvent.click(sku);
    await waitFor(() => expect(sku.hasAttribute("data-copied") || sku.hasAttribute("data-copy-failed")).toBe(true));
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();
  },
};

/** THE LOCK AND THE STOCK'S AGE, AHEAD OF THE CONTRACT — each a filter held in the URL and marked ⚠, its pick thrown away:
 * every product still shows (PRODUCTS_LIST_PENDING). Hapus Filter clears them with the rest. */
export const LockAndAgeFiltersAreHeldAndMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(within(canvas.getByTestId("product-lock-filter")).getByTestId("not-implemented-lockFilter")).toHaveTextContent("1");
    await expect(within(canvas.getByTestId("product-age-filter")).getByTestId("not-implemented-stockAgeFilter")).toHaveTextContent("2");

    await userEvent.click(canvas.getByTestId("product-lock-select"));
    const always = await canvas.findByTestId("product-lock-select-option-always");
    await waitFor(() => expect(always).toBeVisible());
    await userEvent.click(always);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("lock=always"));

    await userEvent.click(canvas.getByTestId("product-age-select"));
    const sixty = await canvas.findByTestId("product-age-select-option-60");
    await waitFor(() => expect(sixty).toBeVisible());
    await userEvent.click(sixty);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("age=60"));

    // Thrown away: an open product, and a young one, still show.
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();

    await userEvent.click(within(canvas.getByTestId("products-filter")).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("lock="));
    await expect(canvas.getByTestId("location-search")).not.toHaveTextContent("age=");
  },
};

/** The product heading sorts by name — A to Z first, then flipped; the server sorts, and the URL keeps it. */
export const TheHeadingSortsByName: Story = {
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

/** A search that finds nothing says so, and its Hapus Filter is the strip's — one function, two buttons
 * (an-empty-list-shows-a-hint). */
export const NothingMatchesAndClears: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "zzz", { delay: 40 });
    const empty = await canvas.findByTestId("products-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No products found.");

    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toBeVisible());
    await expect(canvas.getByTestId("product-search")).toHaveValue("");
  },
};

/** The search reads the name and the SKU, on the live tab. */
export const SearchesByNameOrSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "lada", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-010")).toHaveTextContent("Lada Bubuk");
  },
};

/** THE ARCHIVE IS A PAGE OF ITS OWN (the-archive-is-a-page-of-its-own) — Arsip in the header opens it, with its own title,
 * no figures and no lock or age filter; it holds the archived products only, none of which locks; Back returns to the
 * live list. There is no tab under the list any more. */
export const TheArchiveIsAPageOfItsOwn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("products-tab-archived")).toBeNull();
    await openArchived(canvas);

    await expect(canvas.getByRole("heading", { name: "Archived Products" })).toBeVisible();
    await expect(canvas.queryByTestId("products-stats")).toBeNull();
    await expect(canvas.queryByTestId("product-lock-filter")).toBeNull();
    await expect(canvas.queryByTestId("open-create-product")).toBeNull();

    await expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("Kemasan Lama");
    await expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull();
    await expect(canvas.getByTestId("restore-SKU-ANG-LAMA")).toBeVisible();
    // The lock only READS on an archived row — no button to open its editor.
    await expect(canvas.getByTestId("lock-SKU-ANG-LAMA")).toHaveTextContent("Open");
    await expect(canvas.getByTestId("lock-SKU-ANG-LAMA").tagName).not.toBe("BUTTON");

    await userEvent.click(canvas.getByTestId("products-archive-back"));
    await waitFor(() => expect(canvas.getByTestId("products-page")).toBeInTheDocument());
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();
  },
};

/** Archive confirms first, naming the SKU — and the product moves to the archive. */
export const ArchiveConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("delete-SKU-ANG-002"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SKU-ANG-002");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull());

    await openArchived(canvas);
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();
  },
};

/** Restoring under a SKU a live product took meanwhile is refused, naming the holder — and the screen asks for a new
 * SKU and restores under that. */
export const RestoreCollidesAndAsksForANewSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-001"));
    const dialog = await screen.findByTestId("restore-conflict-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");

    await userEvent.type(within(dialog).getByTestId("restore-new-sku"), "SKU-ANG-001-L", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restore-with-new-sku"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible();
  },
};

/** A free SKU restores at once — the product leaves the Archived tab. */
export const RestoreWithAFreeSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-LAMA"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-LAMA")).toBeNull());
    await expect(screen.queryByTestId("restore-conflict-dialog")).toBeNull();
  },
};

/** Open the lock's popover on a row and wait for it — it portals, so it is found on `screen`. */
async function openLock(canvas: ReturnType<typeof within>, sku: string) {
  await userEvent.click(canvas.getByTestId(`lock-${sku}`));
  const panel = await screen.findByTestId(`lock-${sku}-panel`);
  await waitFor(() => expect(panel).toBeVisible());
  return within(panel);
}

/** THE LOCK IS ONE SETTING, THREE WAYS (one-lock-three-ways), read on the row and edited from it — a popover, not a trip
 * into the product, and the row does not open under it. 700 has a minimum of 4; Always keeps it. */
export const TheLockIsEditedInTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("lock-SKU-ANG-001")).toHaveTextContent("Min 4 pcs");
    await expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Open");

    const panel = await openLock(canvas, "SKU-ANG-001");
    await expect(panel.getByTestId("lock-SKU-ANG-001-field-minimum")).toHaveValue("4");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-001-field-mode-always"));
    await expect(panel.queryByTestId("lock-SKU-ANG-001-field-minimum")).toBeNull();
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-001-save"));

    await waitFor(() => expect(canvas.getByTestId("lock-SKU-ANG-001")).toHaveTextContent("Always locked"));
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();

    // Back to the minimum — the 4 was kept.
    const again = await openLock(canvas, "SKU-ANG-001");
    await userEvent.click(again.getByTestId("lock-SKU-ANG-001-field-mode-min"));
    await expect(again.getByTestId("lock-SKU-ANG-001-field-minimum")).toHaveValue("4");
  },
};

/** A minimum above the stock on hand closes the product to other teams NOW — the row says so with a badge. SKU-ANG-002
 * holds 43 ready; a minimum of 50 is in force. A minimum needs at least 1 to be saved. */
export const AMinimumAboveTheStockLocksItNow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("lock-SKU-ANG-002-now")).toBeNull();

    const panel = await openLock(canvas, "SKU-ANG-002");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-field-mode-min"));
    await expect(panel.getByTestId("lock-SKU-ANG-002-save")).toBeDisabled();
    await userEvent.type(panel.getByTestId("lock-SKU-ANG-002-field-minimum"), "50", { delay: 30 });
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-save"));

    await waitFor(() => expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Min 50 pcs"));
    await expect(await canvas.findByTestId("lock-SKU-ANG-002-now")).toHaveTextContent("Locked");
  },
};

/** Under a warehouse lens the badge is not drawn — the minimum reads the TOTAL stock, and the row then holds one
 * building's. The setting itself still shows. */
export const TheLensHidesTheBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const panel = await openLock(canvas, "SKU-ANG-002");
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-field-mode-min"));
    await userEvent.type(panel.getByTestId("lock-SKU-ANG-002-field-minimum"), "50", { delay: 30 });
    await userEvent.click(panel.getByTestId("lock-SKU-ANG-002-save"));
    await canvas.findByTestId("lock-SKU-ANG-002-now");

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.queryByTestId("lock-SKU-ANG-002-now")).toBeNull());
    await expect(canvas.getByTestId("lock-SKU-ANG-002")).toHaveTextContent("Min 50 pcs");
  },
};

/** A live row opens the product's page; Edit opens its form; New Product opens an empty one. */
export const RowsAndActionsOpenTheirPages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-product-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

export const NewProductOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-product"));
    await waitFor(() => expect(canvas.getByTestId("at-product-new")).toBeInTheDocument());
  },
};

/** Opened at a URL holding a search, the list is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/products?q=lada");
export const TheSearchComesBackFromTheUrl: Story = {
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("product-search", {}, { timeout: 5000 })).toHaveValue("lada");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-010")).toBeVisible());
    await expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull();
  },
};
