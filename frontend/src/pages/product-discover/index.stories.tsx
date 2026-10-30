import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { liveProducts, ownerStockSample, patchProduct } from "../../../.storybook/productStub";
import { asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { readyStatus } from "../../features/products/stockAge";
import { withMarkup } from "../../lib/markup";
import { formatRupiahRange } from "../../lib/money";
import { DiscoverProductsPage } from "./index";
import { sampleDivision, sampleStock } from "./sampleMock";

// The cross-team browse (#106): every team's products, as a grid of cards, each naming its owner — with its filters in
// a panel beside the grid (discover-filters-in-a-side-panel) and the cross price on every card
// (discover-shows-the-cross-price).
//
// The stub's ProductDiscover ignores `team_id` exactly as the server does — the current team is the authorizing scope,
// never a filter — so all 48 fixture products are on offer: four named ones across three teams, then team 15's big
// catalogue. At the page's default of 20 that is pages of 20, 20 and 8.

const SELLING_TEAM = 12n;
const FIGURED_TEAM = 15n; // the stub's catalogue WITH costs — the team whose own products show real figures
const PAGE_SIZE = 20;

const byName = (name: string) => products.find((p) => p.name === name)!;
const teamName = (teamId: bigint) => teams.find((t) => t.id === teamId)!.name;

const KOPI = byName("Kopi Arabika 250g"); // the warehouse's (11)
const TEH = byName("Teh Melati 100g");
const GULA = byName("Gula Pasir 1kg"); // the priority team's (13)
const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's — the team standing here
const MINYAK = liveProducts().find((p) => p.id === 700n)!; // team 15's first, costed in the stub

// The first page as the stub serves it — locked products left out, as the server does — and the card states the samples
// make of other teams' products on it, so a story names a card by what it shows rather than by a fixture position.
const PAGE_1 = liveProducts().slice(0, 20);
const othersOnPage1 = PAGE_1.filter((p) => p.teamId !== SELLING_TEAM);
const LOW_STOCK = othersOnPage1.find((p) => readyStatus(sampleStock(p.id).ready) === "low")!;
const OUT_OF_STOCK = othersOnPage1.find((p) => readyStatus(sampleStock(p.id).ready) === "out")!;
const HEALTHY = othersOnPage1.find((p) => readyStatus(sampleStock(p.id).ready) === "ok")!;
const UMUM = othersOnPage1.find((p) => sampleDivision(p.id) === "general")!;
const PRIORITAS = othersOnPage1.find((p) => sampleDivision(p.id) === "priority")!;

// Positional on purpose: the stub pages the fixture array in order, so these ARE the page boundaries.
const PAGE_2_FIRST = products[PAGE_SIZE]!;
const LAST = products[products.length - 1]!;
const LAST_PAGE_COUNT = products.length % PAGE_SIZE || PAGE_SIZE;

// Only the click-through story mounts this: the rest need no router of their own.
const Routed = routedPage(
  [
    { path: "/products/discover", element: <DiscoverProductsPage /> },
    marker("/products/discover/:productId", "at-discover-detail"),
  ],
  "/products/discover",
);

const meta = {
  title: "Pages/Products/DiscoverProducts",
  component: DiscoverProductsPage,
  parameters: { signedIn: true },
  beforeEach: () => {
    asTeam(SELLING_TEAM)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta<typeof DiscoverProductsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`discover-card-${KOPI.sku}`, {}, { timeout: 4000 });
  return canvas;
}

const cards = (canvas: ReturnType<typeof within>) => canvas.queryAllByTestId(/^discover-card-/);

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// THE DESIGN AS THE OWNER ASKED IT — a product locked to other teams is ON Discover, with its badge (owner: *"lock bukan
// min di default tidak ada"*): Teh Melati is locked here, and this stub's ProductDiscover answers locked products, though
// the server does not send one yet (pending.ts `locked`). Kopi carries a minimum.
const withALockedProduct = () => {
  patchProduct(TEH.id, { crossLocked: true });
};

export const Default: Story = { beforeEach: withALockedProduct };

// A PHONE (every-page-has-a-mobile-story): no panel — the search and a Filter button, the division chips in one row
// that scrolls, and two cards a row.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  beforeEach: withALockedProduct,
};

/** BOTH LOCKS ARE ON THE GRID — Selalu dikunci on Teh Melati, Min 2 pcs on Kopi — in the design the owner asked for. */
export const TheLocksAreOnTheGrid: Story = {
  beforeEach: withALockedProduct,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`discover-lock-${TEH.id}`)).toHaveAttribute("data-mode", "always");
    await expect(canvas.getByTestId(`discover-lock-${KOPI.id}`)).toHaveTextContent("Min 2 pcs");
    await expect(canvas.queryByTestId(`discover-lock-${GULA.id}`)).toBeNull();
  },
};

// Someone in no team at all has no scope to authorize the read, so the page asks for one instead of
// firing a request the server would refuse.
export const NoTeamSelected: Story = {
  beforeEach: asPlatformOnly(Role.WAREHOUSE_ADMIN, []),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("discover-no-team", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("discover-grid")).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Discovery is ACROSS teams, and each card says whose product it is — on a cross-team page that is the
// thing worth knowing. The team standing here is not filtered out either: its own product is on offer
// beside everyone else's.
export const EveryTeamsProductsNamedByOwner: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const product of [KOPI, GULA, BERAS]) {
      const card = canvas.getByTestId(`discover-card-${product.sku}`);
      // The names land after the products (one TeamByIds per page), so the card first reads "Team #<id>".
      await waitFor(() => expect(card).toHaveTextContent(teamName(product.teamId)));
    }
  },
};

/** THE FILTERS ARE A PANEL BESIDE THE GRID, Gudang first and Tim next (owner: *"gudang di atas, lalu tim"*,
 * discover-filters-in-a-side-panel) — then Kategori, Stok and Harga cross. */
export const TheFiltersAreBesideTheGrid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const panel = canvas.getByTestId("discover-filter-panel");

    const order = within(panel)
      .getAllByTestId(/^discover-filter-/)
      .map((el) => el.dataset.testid)
      .filter((id) =>
        ["warehouse", "team", "category", "stock", "cross-range", "lock"].some((g) => id === `discover-filter-${g}`),
      );
    await expect(order).toEqual([
      "discover-filter-warehouse",
      "discover-filter-team",
      "discover-filter-category",
      "discover-filter-stock",
      "discover-filter-cross-range",
      "discover-filter-lock",
    ]);
    // The search and the sort sit over the grid, not in the panel.
    await expect(within(panel).queryByTestId("discover-search")).toBeNull();
    await expect(within(panel).queryByTestId("discover-sort")).toBeNull();
    await expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${products.length}`);
  },
};

/** WHAT CANNOT BE ANSWERED YET IS MARKED where it is — the warehouse, the category, the stock and the price range, the
 * division chips, and another team's cross price — and listed in the strip at the top. */
export const EveryGapIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeInTheDocument();
    for (const [group, id] of [
      ["warehouse", "warehouse"],
      ["category", "category"],
      ["stock", "stock"],
      ["cross-range", "crossRange"],
      ["lock", "lockFilter"],
    ] as const) {
      await expect(within(canvas.getByTestId(`discover-filter-${group}`)).getByTestId(`not-implemented-${id}`)).toBeInTheDocument();
    }
    await expect(within(canvas.getByTestId("discover-division")).getByTestId("not-implemented-division")).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId(`discover-card-${KOPI.sku}`)).getByTestId("not-implemented-crossPrice"),
    ).toBeInTheDocument();
  },
};

/** DISCOVER OPENS ON PRIORITAS (owner: *"secara default di tampilkan yang prioritas semua"*); another chip is a change
 * Hapus Filter takes back — to Prioritas, not to Semua. */
export const PriorityIsWhereItOpens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const chip = (d: string) => canvas.getByTestId(`discover-division-${d}`);

    await expect(chip("priority")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.queryByTestId("discover-filter-panel-clear")).toBeNull();

    await userEvent.click(chip("research"));
    await expect(chip("research")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(await canvas.findByTestId("discover-filter-panel-clear"));
    await waitFor(() => expect(chip("priority")).toHaveAttribute("aria-pressed", "true"));
  },
};

/** ANOTHER TEAM'S CARD SAYS THE CROSS PRICE, and only that (discover-shows-the-cross-price) — what a borrower pays. Its
 * cost cannot be read across teams yet, so the figure carries its ⚠. NO LABEL BESIDE IT (owner: *"harga apa tidak perlu
 * diberi label tooltips saja"*, a-discover-price-is-red-and-unlabelled): the figure alone, in red, and a hover says what it
 * is. */
export const AnotherTeamsCardSaysTheCrossPrice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const price = canvas.getByTestId(`discover-price-cross-${KOPI.id}`);

    await expect(price).toHaveTextContent(/^Rp\s?[\d.]+/);
    await expect(canvas.queryByTestId(`discover-price-cost-${KOPI.id}`)).toBeNull();
    // The figure alone on the card; its name is spoken, and shown on hover.
    await expect(canvas.getByTestId(`discover-price-${KOPI.id}`)).not.toHaveTextContent(/Cross/);
    await expect(price).toHaveAttribute("aria-label", expect.stringMatching(/^Cross Rp/));

    await userEvent.hover(price);
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(/what another team pays/));
  },
};

/** THE TEAM'S OWN PRODUCT SAYS ITS COST AND ITS CROSS PRICE (owner: *"khusus untuk team yang login … boleh menampilkan
 * harga asli dan harga cross"*) — real figures, from the owner's own stock read; no ⚠ on them. */
export const YourOwnProductSaysCostAndCross: Story = {
  beforeEach: asTeam(FIGURED_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const stock = ownerStockSample(MINYAK.id, FIGURED_TEAM, 0n)!;
    const card = canvas.getByTestId(`discover-card-${MINYAK.sku}`);

    await waitFor(() =>
      expect(canvas.getByTestId(`discover-price-cost-${MINYAK.id}`)).toHaveTextContent(
        formatRupiahRange(stock.costMin, stock.costMax),
      ),
    );
    await expect(canvas.getByTestId(`discover-price-cross-${MINYAK.id}`)).toHaveTextContent(
      formatRupiahRange(withMarkup(stock.costMin, MINYAK.crossMarkupBps), withMarkup(stock.costMax, MINYAK.crossMarkupBps)),
    );
    await expect(within(card).queryByTestId("not-implemented-crossPrice")).toBeNull();
    // Its stock is real too, the owner's own read — and unmarked.
    await expect(canvas.getByTestId(`discover-stock-ready-${MINYAK.id}`)).toHaveTextContent(`${stock.readyQty} pcs`);
    await expect(within(card).queryByTestId("not-implemented-cardStock")).toBeNull();
    // The cost UNDER the cross price (a-discover-price-is-red-and-unlabelled) — the cross price is the card's figure.
    const shown = within(canvas.getByTestId(`discover-price-${MINYAK.id}`))
      .getAllByTestId(/^discover-price-(cross|cost)-/)
      .map((el) => el.dataset.testid);
    await expect(shown).toEqual([`discover-price-cross-${MINYAK.id}`, `discover-price-cost-${MINYAK.id}`]);
    // Another team's card beside it still says the cross price alone.
    await expect(canvas.queryByTestId(`discover-price-cost-${KOPI.id}`)).toBeNull();
  },
};

/** SEMBUNYIKAN PRODUK SAYA — only other teams' products; the team's own leaves the grid. A click on its WORDS ticks it —
 * not the team picker above it in the same group (owner: *"tidak bisa diklik malah ke selectnya"*). */
export const HideMineLeavesOtherTeams: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId(`discover-card-${BERAS.sku}`)).toBeInTheDocument();

    await userEvent.click(canvas.getByText("Hide my products"));

    await expect(within(canvas.getByTestId("discover-filter-hide-mine")).getByRole("checkbox")).toBeChecked();
    await expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${BERAS.sku}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${KOPI.sku}`)).toBeInTheDocument();
  },
};

/** THE RANGES ARE PICKED (owner: *"untuk stok dan price rangenya pilih saja, kalau mau custom kudu klik tombol dulu"*) —
 * a band is one click; the boxes for a range of one's own open only from Atur sendiri, and a typed stock is held under
 * 100.000. */
export const TheRangesArePicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const stock = within(canvas.getByTestId("discover-stock-range"));

    // No boxes until asked for.
    await expect(stock.queryByTestId("discover-stock-range-min")).toBeNull();
    // KOSONG first, after Semua (owner: *"ada juga filter stok kosong"*) — nothing ready, a band of its own.
    const empty = stock.getByTestId("discover-stock-range-chips-0-0");
    await expect(empty).toHaveTextContent("Empty");
    await userEvent.click(empty);
    await expect(empty).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(stock.getByTestId("discover-stock-range-chips-11-50"));
    await expect(stock.getByTestId("discover-stock-range-chips-11-50")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByTestId("discover-filter-panel")).toHaveAttribute("data-filtering", "true");

    // Atur sendiri: the band lets go, the boxes open, and a stock past the ceiling is held at it.
    await userEvent.click(stock.getByTestId("discover-stock-range-custom"));
    await expect(stock.getByTestId("discover-stock-range-custom")).toHaveAttribute("aria-pressed", "true");
    await expect(stock.getByTestId("discover-stock-range-chips-11-50")).toHaveAttribute("aria-pressed", "false");
    // The test id is on the input itself (QuantityInput).
    const max = stock.getByTestId("discover-stock-range-max") as HTMLInputElement;
    await userEvent.type(max, "250000", { delay: 20 });
    await waitFor(() => expect(Number(max.value.replace(/\D/g, ""))).toBe(100000));

    // A band again closes the boxes.
    await userEvent.click(stock.getByTestId("discover-stock-range-chips-1-10"));
    await waitFor(() => expect(stock.queryByTestId("discover-stock-range-max")).toBeNull());

    // The price is picked the same way.
    const cross = within(canvas.getByTestId("discover-cross-range"));
    await userEvent.click(cross.getByTestId("discover-cross-range-chips-0-10000"));
    // The unit once, at the end, no "Rp" (owner: *"contoh 100rb-250rb jadi 100-250rb"*).
    await expect(cross.getByTestId("discover-cross-range-chips-0-10000")).toHaveTextContent("≤ 10rb");
    await expect(cross.getByTestId("discover-cross-range-chips-100000-250000")).toHaveTextContent("100–250rb");
    await expect(cross.getByTestId("discover-cross-range-chips-500000-1000000")).toHaveTextContent("500rb–1jt");
  },
};

/** TERBUKA · TERKUNCI (owner: *"filter terkunci dan terbuka, terkunci itu yang kena dikunci dan stoknya <= min"*) — chips
 * in the panel, Semua first; a pick narrows nothing yet, so the group carries its ⚠, and Hapus Filter takes it back. */
export const TheLockFilterIsOpenOrLocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const lock = within(canvas.getByTestId("discover-filter-lock"));

    await expect(lock.getByTestId("discover-lock-filter-")).toHaveAttribute("aria-pressed", "true");
    await expect(lock.getByTestId("not-implemented-lockFilter")).toBeInTheDocument();
    await userEvent.click(lock.getByTestId("discover-lock-filter-locked"));
    await expect(lock.getByTestId("discover-lock-filter-locked")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(await canvas.findByTestId("discover-filter-panel-clear"));
    await waitFor(() => expect(lock.getByTestId("discover-lock-filter-")).toHaveAttribute("aria-pressed", "true"));
  },
};

/** THE CATEGORY PICKER OPENS OVER THE GRID (owner: *"filter kategori ketutupan card produk"*) — its columns grow out of the
 * panel toward the cards, and stay on top of them: the panel is layered above the list beside it. */
export const TheCategoryPickerOpensOverTheGrid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(within(canvas.getByTestId("discover-filter-category")).getByTestId("category-select"));
    await userEvent.click(await canvas.findByTestId("category-drill-Elektronik"));

    const search = await canvas.findByTestId("category-search");
    const popover = search.closest("[data-part=\"content\"]") as HTMLElement;
    const panel = canvas.getByTestId("discover-filter-panel").getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    // It reaches past the panel, over the grid…
    await waitFor(() => expect(popover.getBoundingClientRect().right).toBeGreaterThan(panel.right));
    // …and what is painted there is the picker, not a card.
    const there = document.elementFromPoint(box.right - 16, box.top + box.height / 2);
    await expect(popover.contains(there)).toBe(true);
  },
};

/** THE DIVISION AND THE LOCK RIDE ON THE COVER (owner: *"keterangannya kurang terlihat, kasih di atas sendiri"*) — and
 * UMUM CARRIES NO BADGE (*"di card tidak perlu badge untuk yang umum"*): the ordinary case; Prioritas keeps its own. */
export const TheBadgesAreOnTheCover: Story = {
  beforeEach: withALockedProduct,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const coverOf = (id: bigint) =>
      within(canvas.getByTestId(`product-card-${id}`)).getByTestId("product-card-cover-badges");

    await expect(within(coverOf(KOPI.id)).getByTestId(`discover-lock-${KOPI.id}`)).toHaveTextContent("Min 2 pcs");
    await expect(within(coverOf(TEH.id)).getByTestId(`discover-lock-${TEH.id}`)).toHaveAttribute("data-mode", "always");
    await expect(canvas.queryByTestId(`discover-division-badge-${UMUM.id}`)).toBeNull();
    await expect(canvas.getByTestId(`discover-division-badge-${PRIORITAS.id}`)).toHaveTextContent("Priority");
  },
};

/** RUNNING LOW IS HIGHLIGHTED (owner: *"stock menipis ada highlight"*) — under 5 ready in the warning tone, none in the
 * error tone; a healthy figure stays plain. */
export const LowStockIsHighlighted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`discover-stock-ready-${LOW_STOCK.id}`)).toHaveAttribute("data-status", "low");
    await expect(canvas.getByTestId(`discover-stock-ready-${OUT_OF_STOCK.id}`)).toHaveAttribute("data-status", "out");
    await expect(canvas.getByTestId(`discover-stock-ready-${HEALTHY.id}`)).toHaveAttribute("data-status", "ok");
  },
};

/** THE ORDER IS A SELECT over the grid — the newest first, or by name, A to Z. */
export const SortsByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-sort"));
    const byName = await canvas.findByRole("option", { name: "Name A–Z" });
    await waitFor(() => expect(byName).toBeVisible());
    await userEvent.click(byName);

    const first = [...liveProducts()].sort((a, b) => a.name.localeCompare(b.name))[0]!;
    await waitFor(() => expect(cards(canvas)[0]).toHaveAttribute("data-testid", `discover-card-${first.sku}`));
  },
};

export const SearchesSkuAndName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const search = canvas.getByTestId("discover-search");

    await userEvent.type(search, "gula", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${KOPI.sku}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${GULA.sku}`)).toBeVisible();

    await userEvent.clear(search);
    await userEvent.type(search, TEH.sku, { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${GULA.sku}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${TEH.sku}`)).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the browse is narrowed by it (the
// search and the owner team); a new search is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/products/discover", element: <><DiscoverProductsPage /><LocationProbe /></> }],
  `/products/discover?q=gula&team=${GULA.teamId}`,
);

export const FiltersLiveInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId(`discover-card-${GULA.sku}`, {}, { timeout: 4000 });
    const search = canvas.getByTestId("discover-search");
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("gula");
    await expect(canvas.queryByTestId(`discover-card-${KOPI.sku}`)).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "kopi", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("q=kopi"));
    // Kopi is the warehouse's, not team 13's — the team in the URL still narrows, so nothing matches.
    await canvas.findByTestId("discover-none-match", {}, { timeout: 4000 });
  },
};

// AN EMPTY BROWSE SAYS WHY, and offers to clear what narrowed it (an-empty-list-shows-a-hint).
export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("discover-search"), "zzz", { delay: 40 });

    const hint = await canvas.findByTestId("discover-none-match", {}, { timeout: 4000 });
    await expect(cards(canvas)).toHaveLength(0);

    await userEvent.click(within(hint).getByRole("button"));
    await canvas.findByTestId(`discover-card-${KOPI.sku}`, {}, { timeout: 4000 });
  },
};

export const PagesThroughTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.sku}`, {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${KOPI.sku}`)).toBeNull());
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    // The short last page.
    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${LAST.sku}`, {}, { timeout: 4000 });
    await waitFor(() => expect(cards(canvas)).toHaveLength(LAST_PAGE_COUNT));
  },
};

// A new search starts again from page 1. Left on page 3, "kopi" — three matches, one page — would ask
// for a page that does not exist and read as "No products found".
export const SearchStartsAgainFromPageOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.sku}`, {}, { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${LAST.sku}`, {}, { timeout: 4000 });

    await userEvent.type(canvas.getByTestId("discover-search"), "kopi", { delay: 40 });

    await canvas.findByTestId(`discover-card-${KOPI.sku}`, {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("discover-none-match")).toBeNull();
  },
};

// A bigger page holds the whole catalogue.
export const FiftyPerPageHoldsTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-pager-size"));
    const fifty = await canvas.findByRole("option", { name: "50" });
    await waitFor(() => expect(fifty).toBeVisible());
    await userEvent.click(fifty);

    await waitFor(() => expect(cards(canvas)).toHaveLength(products.length));
  },
};

// A card opens the DISCOVER detail — never the owner's /products/:id, which answers only the owning team
// and would read every other team's product as not found.
export const ACardOpensTheDiscoverDetail: Story = {
  parameters: { dataRouter: true },
  render: () => <Routed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`discover-open-${GULA.sku}`));
    await canvas.findByTestId("at-discover-detail");
  },
};

/** ON A PHONE THE SAME FILTERS ARE IN THE SHEET (a-phone-filters-from-a-sheet) — no panel; the search stays in the row,
 * and the Filter button opens every group, the sort last. */
export const APhoneFiltersFromTheSheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("discover-filter-panel")).toBeNull();
    await expect(canvas.getByTestId("discover-search")).toBeVisible();

    await userEvent.click(canvas.getByTestId("discover-filter-open"));
    const sheet = await screen.findByTestId("discover-filter-sheet");
    for (const group of ["warehouse", "team", "category", "stock", "cross-range", "lock", "sort"]) {
      await expect(within(sheet).getByTestId(`discover-filter-${group}`)).toBeInTheDocument();
    }
  },
};
