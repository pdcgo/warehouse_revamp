import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams, warehouseStock } from "../../../.storybook/fixtures";
import { asTeam, marker, markerWithSearch, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { ownerStockSample, patchProduct, shelfSample } from "../../../.storybook/productStub";
import { asRole } from "../../../.storybook/sessionScenario";
import { discoverPriceOf, sampleDivision } from "../../features/products/discoverSample";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiahRange } from "../../lib/money";
import { DiscoverProductDetailPage } from "./index";

// ANOTHER team's product, as a selling team deciding whether to sell it — the discover detail, in the owner's page's
// shape (the-discover-detail-is-the-product-page).
//
// Team 12 (Toko Melati) stands here. The fixture stock is one building's (Gudang Pusat, 11), and the stub
// answers the second warehouse (Gudang Cabang, 14) with zeros — so every page shows one stocked row and
// one empty one, which is the comparison the table exists for.

const SELLING_TEAM = 12n;

const byName = (name: string) => products.find((p) => p.name === name)!;
const teamName = (id: bigint) => teams.find((t) => t.id === id)!.name;

const GULA = byName("Gula Pasir 1kg"); // Toko Kenanga's (13), 1.5% markup, no reserve — its division a sample Riset
const KOPI = byName("Kopi Arabika 250g"); // reserves 2 of its 40
const TEH = byName("Teh Melati 100g"); // the one a story locks or archives
const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's own

const STOCKED = teams[0]!; // Gudang Pusat
const EMPTY = teams[3]!; // Gudang Cabang

// TEAM 15'S CATALOGUE carries batches in BOTH warehouses at different costs (productStub.ts) — the own product whose
// prices differ per warehouse.
const FIGURED_TEAM = 15n;
const MINYAK_ID = 700n;

function routedAt(productId: bigint | string) {
  return routedPage(
    [
      { path: "/products/discover/:productId", element: <DiscoverProductDetailPage /> },
      marker("/products/discover", "at-discover"),
      marker("/products/:productId", "at-own-product"),
      marker("/inventories/suppliers/discover/:supplierId", "at-supplier"),
      markerWithSearch("/orders/new", "at-order-form"),
    ],
    `/products/discover/${productId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
const AtGula = routedAt(GULA.id);
const AtKopi = routedAt(KOPI.id);
const AtTeh = routedAt(TEH.id);
const AtBeras = routedAt(BERAS.id);
const AtMinyak = routedAt(MINYAK_ID);
const AtNothing = routedAt(999n);

/** A `beforeEach` that flips one flag on Teh for the story — in the product stub, whose reset puts it back. */
function tehIs(flag: "crossLocked" | "deleted") {
  return () => patchProduct(TEH.id, { [flag]: true });
}

// A FLAT DRAWING OF A BAG OF SUGAR, as the fixtures draw Beras's rice — so the Default story shows the product's picture
// (owner: *"gambar produk ada"*). Given to Gula for this file only, through the stub, whose reset takes it back.
const SUGAR_PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#e0f2fe"/>` +
    `<path d="M18 14h28l4 40H14z" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>` +
    `<rect x="20" y="28" width="24" height="12" fill="#0284c7"/>` +
    `</svg>`,
)}`;

const meta = {
  title: "Pages/Products/DiscoverProductDetail",
  component: AtGula,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(SELLING_TEAM)();
    asRole(Role.SELLING_OWNER)();
    patchProduct(GULA.id, { defaultImageUrl: SUGAR_PICTURE, defaultImageThumbnailUrl: SUGAR_PICTURE });
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("discover-detail-page", {}, { timeout: 4000 });
  return canvas;
}

/** A section's own queries — the sections are cards on one page. */
async function sectionOf(canvas: ReturnType<typeof within>, key: "info" | "derived" | "price" | "warehouse") {
  return within(await canvas.findByTestId(`dd-section-${key}`));
}

/** Open one tab of the Per Gudang card, and query its panel. */
async function openTab(canvas: ReturnType<typeof within>, key: "overview" | "suppliers" | "daily" | "history") {
  await userEvent.click(await canvas.findByTestId(`dd-tab-${key}`));
  await waitFor(() => expect(canvas.getByTestId(`dd-panel-${key}`)).toBeVisible());
  return within(canvas.getByTestId(`dd-panel-${key}`));
}

async function stockLoaded(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await canvas.findByTestId(`discover-stock-row-${STOCKED.id}`, {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ⚠ NO `play()`: the `viewport` global resizes the workbench canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories). For looking — the section chips stick, each warehouse is a block.
export const Mobile: Story = { globals: { viewport: { value: "mobile2" } } };

export const WithAReserve: Story = { render: () => <AtKopi /> };

export const YourOwnProduct: Story = { render: () => <AtBeras /> };

export const Locked: Story = { beforeEach: tehIs("crossLocked"), render: () => <AtTeh /> };

export const Archived: Story = { beforeEach: tehIs("deleted"), render: () => <AtTeh /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE OWNER'S PAGE'S SHAPE: back as an icon beside the name, the SKU under it, a nav beside one page of sections — Info,
// Penjualan Tim Lain, Produk Turunan, Harga per Gudang, Per Gudang — and the large ready figure leading Info. Per Gudang is
// the owner's page's warehouse card WITHOUT Harga Modal; Harga per Gudang stands above it in its stead
// (the-discover-detail-has-the-warehouse-zone).
export const TheOwnersPageShape: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent(GULA.name);
    await expect(canvas.getByTestId("discover-detail-sku")).toHaveTextContent(GULA.sku);
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

// WHAT and WHOSE: the owning team is named — on a cross-team page that is the fact worth knowing — BY NAME ALONE, under
// *Team*: it is a selling team, so an avatar and a type badge said nothing. The category and the cross price in Info — and
// NO markup percentage (the-discover-detail-shows-no-markup). An open product carries no lock badge.
export const NamesTheTeamNotTheMarkup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() => expect(info.getByTestId("discover-detail-owner")).toHaveTextContent(teamName(GULA.teamId)));
    await expect(info.getByTestId("discover-detail-info-team")).toHaveTextContent(/^Team/);
    await expect(info.getByTestId("discover-detail-owner")).not.toHaveTextContent("Selling");
    await expect(info.getByTestId("discover-detail-category")).toHaveTextContent("Rumah Tangga");
    await expect(canvas.queryByTestId("discover-detail-markup")).toBeNull();
    await expect(canvas.getByTestId("discover-detail-page")).not.toHaveTextContent("1.5%");
    await expect(canvas.queryByTestId(`discover-detail-lock-${GULA.id}`)).toBeNull();
    // Somebody else's product: no way "home", and no cost of the owner's.
    await expect(canvas.queryByTestId("discover-detail-open-own")).toBeNull();
    await expect(info.queryByTestId("discover-detail-cost")).toBeNull();
  },
};

// THE PICTURE AND PRODUK TURUNAN, as on the owner's page (owner: *"gambar produk ada, produk turunan juga ditampilkan"*):
// the shared gallery shows the cover — the one picture a by-ids row carries, marked — and the derived products are the
// owner's page's sample rows, marked too.
export const ThePictureAndTheDerivedProducts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const derived = await sectionOf(canvas, "derived");

    await expect(info.getByTestId("discover-detail-image-0")).toHaveAttribute("src", SUGAR_PICTURE);
    await expect(info.getByTestId("not-implemented-gallery")).toBeInTheDocument();
    await expect(derived.getByTestId("pd-derived-to")).toBeInTheDocument();
    await expect(derived.getAllByTestId(/^pd-derived-to-\d+$/).length).toBeGreaterThan(0);
    await expect(derived.getByTestId("not-implemented-derived")).toBeInTheDocument();
  },
};

// A product with no picture says so — its cover is its first image, so there is no gallery to mark.
export const NoPictureSaysSo: Story = {
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(info.getByTestId("discover-detail-no-images")).toBeInTheDocument();
    await expect(info.queryByTestId("not-implemented-gallery")).toBeNull();
  },
};

// THE CROSS PRICE is the card's: the same rule (discoverPriceOf), so the card and its page never disagree — red, and
// marked, since another team's cost is invented.
export const TheCrossPriceIsTheCards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const price = discoverPriceOf(GULA.id, GULA.crossMarkupBps, false);

    await expect(info.getByTestId("discover-detail-cross")).toHaveTextContent(
      formatRupiahRange(price.cross!.min, price.cross!.max),
    );
  },
};

// THE CARD'S BADGES, BESIDE THE NAME — the division a sample (Gula's is Riset), the lock absent while it is open.
export const TheCardsBadgesAreOnTheTitle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(sampleDivision(GULA.id)).toBe("research");
    await expect(canvas.getByTestId(`discover-detail-division-badge-${GULA.id}`)).toHaveTextContent("Research");
    await expect(canvas.queryByTestId(`discover-detail-lock-${GULA.id}`)).toBeNull();
  },
};

// WHERE: every warehouse gets a row, including the one holding nothing — out of stock there is the
// answer worth seeing, not a row to hide. Nothing on its shelf, so nothing priced there.
export const EveryWarehouseHasARow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const shelf = warehouseStock[GULA.id.toString()]!.toString();

    await expect(canvas.getByTestId(`discover-stock-ready-${STOCKED.id}`)).toHaveTextContent(`${shelf} pcs`);

    await expect(canvas.getByTestId(`discover-stock-row-${EMPTY.id}`)).toHaveTextContent(EMPTY.name);
    await expect(canvas.getByTestId(`discover-stock-ready-${EMPTY.id}`)).toHaveTextContent("0 pcs");
    await expect(canvas.getByTestId(`discover-stock-cross-${EMPTY.id}`)).toHaveTextContent("—");
    // "You can take" left the table (each-warehouse-says-ready-and-its-price).
    await expect(canvas.queryByText("You can take")).toBeNull();
  },
};

// AT WHAT PRICE, per warehouse: another team's is the card's invented range shared out among the warehouses holding it —
// Gula is held in one, so that one's price is the whole range Info says — marked, as Info's is.
export const EachWarehouseHasItsPrice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const price = await sectionOf(canvas, "price");

    await expect(price.getByTestId(`discover-stock-cross-${STOCKED.id}`)).toHaveTextContent(
      canvas.getByTestId("discover-detail-cross").textContent!,
    );
    await expect(price.getByTestId("not-implemented-crossPrice")).toBeInTheDocument();
    // Another team's cost is never shown.
    await expect(price.queryByTestId(`discover-stock-cost-${STOCKED.id}`)).toBeNull();
  },
};

// THE TEAM'S OWN PRODUCT, PRICED PER WAREHOUSE FROM ITS OWN BATCHES — team 15's Minyak came in at different costs in its
// two warehouses, so each row says its own: the cross price, and the cost under it. Real figures, so unmarked.
export const YourOwnProductPricesEachWarehouse: Story = {
  beforeEach: asTeam(FIGURED_TEAM),
  render: () => <AtMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const warehouse = await sectionOf(canvas, "price");

    for (const w of [STOCKED, EMPTY]) {
      const stock = ownerStockSample(MINYAK_ID, FIGURED_TEAM, w.id)!;

      await expect(warehouse.getByTestId(`discover-stock-ready-${w.id}`)).toHaveTextContent(`${shelfSample(MINYAK_ID, w.id)} pcs`);
      await waitFor(() =>
        expect(warehouse.getByTestId(`discover-stock-cost-${w.id}`)).toHaveTextContent(
          formatRupiahRange(stock.costMin, stock.costMax),
        ),
      );
    }
    await expect(warehouse.getByTestId(`discover-stock-cost-${STOCKED.id}`).textContent).not.toBe(
      warehouse.getByTestId(`discover-stock-cost-${EMPTY.id}`).textContent,
    );
    await expect(warehouse.queryByTestId("not-implemented-crossPrice")).toBeNull();
  },
};

// THE LARGE FIGURE IS THE TABLE ADDED UP — every shelf summed, so the two can never disagree.
export const TheReadyFigureIsTheShelvesSummed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() =>
      expect(info.getByTestId("discover-detail-highlight-ready")).toHaveTextContent(
        `${warehouseStock[GULA.id.toString()]} pcs ready`,
      ),
    );
    await expect(info.getByTestId("discover-detail-highlight-status")).toHaveAttribute("data-status", "ok");
  },
};

// THE OWNER'S RESERVE READS ON THE TITLE'S LOCK BADGE (the-lock-is-the-title-badge) — Kopi keeps 2 of its 40: *Min 2
// pcs*, not in force. It is not taken off any warehouse's figure: the table says what is ready.
export const AReserveReadsOnTheLock: Story = {
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const badge = canvas.getByTestId(`discover-detail-lock-${KOPI.id}`);

    await expect(canvas.getByTestId(`discover-stock-ready-${STOCKED.id}`)).toHaveTextContent(
      `${warehouseStock[KOPI.id.toString()]} pcs`,
    );
    await expect(badge).toHaveTextContent(`Min ${KOPI.reservedStock} pcs`);
    await expect(badge).not.toHaveAttribute("data-now");
  },
};

// A MINIMUM IN FORCE SAYS LOCKED (owner: *"tapi kalau min gimana?"*) — Kopi's minimum raised to its whole 40: the ready
// stock is AT the minimum (the-minimum-closes-at-the-minimum), so the badge reads *Locked · Min 40 pcs*, its reason in
// a tooltip.
export const AMinimumInForceSaysLocked: Story = {
  beforeEach: () => patchProduct(KOPI.id, { reservedStock: Number(warehouseStock[KOPI.id.toString()]) }),
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const badge = canvas.getByTestId(`discover-detail-lock-${KOPI.id}`);
    const shelf = warehouseStock[KOPI.id.toString()]!;

    await waitFor(() => expect(badge).toHaveAttribute("data-now", "true"));
    await expect(badge).toHaveTextContent(`Locked · Min ${shelf} pcs`);
    await expect(badge).toHaveAttribute("title", expect.stringContaining(`${shelf}`));
  },
};

// Discovery lists your own products too; opening one offers the way to the owner's page — the title row's action —
// which has the cost story and the controls this one deliberately lacks. Its own cost shows, as on its card.
export const YourOwnProductPointsHome: Story = {
  render: () => <AtBeras />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(info.getByTestId("discover-detail-cost")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("discover-detail-open-own"));
    await canvas.findByTestId("at-own-product");
  },
};

// A LOCKED product is on Discover with its badge (a-locked-product-shows-on-discover); its page says why where the ready
// figure would stand, and offers no stock — but still says who sells it: a team may restock from another team's
// supplier itself.
export const LockedSaysSoAndOffersNoStock: Story = {
  beforeEach: tehIs("crossLocked"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const price = await sectionOf(canvas, "price");

    await expect(info.getByTestId("discover-detail-locked")).toBeVisible();
    await expect(info.queryByTestId("discover-detail-highlight")).toBeNull();
    await expect(canvas.getByTestId(`discover-detail-lock-${TEH.id}`)).toHaveTextContent("Locked");
    await expect(price.getByTestId("discover-detail-stock-not-offered")).toBeVisible();
    await expect(price.queryByTestId(/^discover-stock-row-/)).toBeNull();
    const suppliers = await openTab(canvas, "suppliers");
    await waitFor(() => expect(suppliers.getByTestId("pd-supplier-row-0")).toBeInTheDocument());
  },
};

export const ArchivedSaysSoAndOffersNoStock: Story = {
  beforeEach: tehIs("deleted"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-archived")).toBeVisible();
    await expect(canvas.getByTestId("discover-detail-archived-badge")).toBeInTheDocument();
    await expect(canvas.queryByTestId("discover-detail-locked")).toBeNull();
    await expect(canvas.queryByTestId(/^discover-stock-row-/)).toBeNull();
  },
};

// WHO SELLS IT — a tab of Per Gudang, as on the owner's page: each supplier opening the supplier DISCOVER detail (it is
// usually another team's), the store it was bought at beside it. ⚠ Sample rows (pending "suppliers").
export const SuppliersOpenTheSupplierDiscoverDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");

    await waitFor(() => expect(suppliers.getAllByTestId(/^pd-supplier-row-\d+$/).length).toBeGreaterThan(0));
    await userEvent.click(suppliers.getAllByTestId(/^supplier-open-/)[0]!);
    await canvas.findByTestId("at-supplier");
  },
};

// THE SUPPLIER'S STORE (the-supplier-tab-names-the-store): its name, the marketplace UNDER it, and — when it has a link —
// the name opens the store in a new tab. No cost on this page: the last cost is the owner's.
export const TheSupplierStoreOpensItsLink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");

    const link = await waitFor(() => suppliers.getAllByTestId(/^supplier-store-link-/)[0]!);
    await expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(suppliers.queryByTestId("pd-supplier-cost-0")).toBeNull();
    await expect(suppliers.queryByText("Last cost")).toBeNull();
  },
};

// THE WAREHOUSE CARD'S OVERVIEW — the lens's small figures: Siap, Dikirim and the CROSS PRICE RANGE, no stock age
// (the-overview-says-the-cross-range). Gula's 12 ready at Info's cross price in every warehouse; none, and no price, once
// Gudang Cabang is picked. Harga per Gudang above the card does not move with the picker.
export const TheOverviewFollowsThePicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const warehouse = await sectionOf(canvas, "warehouse");
    const shelf = warehouseStock[GULA.id.toString()]!;

    await waitFor(() => expect(warehouse.getByTestId("dd-overview-ready")).toHaveTextContent(`${shelf} pcs`));
    await expect(warehouse.getByTestId("dd-overview-cross")).toHaveTextContent(canvas.getByTestId("discover-detail-cross").textContent!);
    await expect(warehouse.queryByTestId("dd-overview-row-age")).toBeNull();
    await expect(warehouse.queryByTestId("dd-overview-row-cost")).toBeNull();

    await pickTeam(canvas.getByTestId("dd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(warehouse.getByTestId("dd-overview-ready")).toHaveTextContent("0 pcs"));
    await expect(warehouse.getByTestId("dd-overview-cross")).toHaveTextContent("—");
    await expect(warehouse.getByTestId("pd-warehouse-note")).toBeVisible();
    // The price section is every warehouse, still.
    await expect(canvas.getByTestId(`discover-stock-row-${STOCKED.id}`)).toBeInTheDocument();
  },
};

// RIWAYAT STOK IS EVERYONE'S (stock-history-is-everyones) — another team's product shows the ledger, its rows a sample
// (marked) that ends at the real shelf: Gula's newest Gudang Pusat movement leaves exactly what is ready there.
export const AnotherTeamsHistoryIsShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);

    await expect(within(canvas.getByTestId("dd-tab-history")).getByTestId("not-implemented-history")).toBeInTheDocument();
    const history = await openTab(canvas, "history");
    const table = await history.findByTestId("pd-history-table");
    const rows = within(table).getAllByRole("row").slice(1);

    await expect(rows.length).toBe(5);
    // No Batch column here (the-discover-history-names-no-batch) — the warehouse names each movement's building.
    const headings = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    await expect(headings).toContain('Warehouse');
    await expect(headings).not.toContain('Batch');
    await expect(rows[0]).toHaveTextContent(`${warehouseStock[GULA.id.toString()]}`);
  },
};

// ProductByIds omits an id it cannot resolve rather than failing, so "not found" is the page's own call.
export const AnUnknownIdIsNotFound: Story = {
  render: () => <AtNothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("discover-detail-error")).toHaveTextContent("Product not found.");
  },
};

export const BackGoesToDiscover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

// BUAT PESANAN — the warehouse and the quantity first (the-order-and-restock-start-on-the-page): Gudang Cabang holds no
// Gula, so it cannot be picked; more than Gudang Pusat's 12 cannot continue. Then the order form with the product on it
// (a-product-page-opens-the-order-and-restock-forms). Discover opens no restock.
export const OrderOpensTheOrderForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const shelf = warehouseStock[GULA.id.toString()]!;

    await expect(canvas.queryByTestId("discover-detail-restock")).toBeNull();
    await userEvent.click(canvas.getByTestId("discover-detail-order"));
    const dialog = await screen.findByTestId("start-order-dialog");

    await waitFor(() => expect(within(dialog).getByTestId(`start-warehouse-ready-${STOCKED.id}`)).toHaveTextContent(`${shelf} pcs`));
    await expect(within(dialog).getByTestId(`start-warehouse-ready-${EMPTY.id}`)).toHaveTextContent("Out of stock");

    const qty = within(dialog).getByTestId("start-quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, `${shelf + 1n}`, { delay: 40 });
    await expect(within(dialog).getByTestId("start-quantity-over")).toBeInTheDocument();
    await expect(within(dialog).getByTestId("start-order-continue")).toBeDisabled();

    await userEvent.clear(qty);
    await userEvent.type(qty, "3", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("start-order-continue"));

    await canvas.findByTestId("at-order-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(`?product=${GULA.id}&warehouse=${STOCKED.id}&qty=3`);
  },
};

// HELD BACK while another team may not order it — the owner's lock here — with the reason on it.
export const OrderIsHeldBackWhileLocked: Story = {
  beforeEach: tehIs("crossLocked"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const order = canvas.getByTestId("discover-detail-order");

    await expect(order).toBeDisabled();
    await expect(order.parentElement).toHaveAttribute("title", expect.stringContaining("Locked by its owner"));
  },
};

// NOTHING READY IN ANY WAREHOUSE (an-empty-product-cannot-start-an-order) — team 15's Tepung holds no stock anywhere, so
// Buat Pesanan is held back with the reason; the form would only refuse it.
const AtTepung = routedAt(702n);
export const OrderIsHeldBackWithNoStock: Story = {
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const order = canvas.getByTestId("discover-detail-order");

    await waitFor(() => expect(order).toBeDisabled());
    await expect(order.parentElement).toHaveAttribute("title", "No stock is ready in any warehouse.");
  },
};
