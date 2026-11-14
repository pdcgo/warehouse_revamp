import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { pickTeam } from "../../../../.storybook/pageStory";
import { discoverStockSample, liveProducts, patchProduct } from "../../../../.storybook/productStub";
import { discoverStockCalls, productDiscoverCalls } from "../../../../.storybook/productListScenario";
import { ProductLockFilter } from "../../../gen/warehouse/product/v1/product_pb";
import {
  AT,
  AtDiscover,
  AtDiscoverWith,
  BERAS,
  CABANG,
  DISCOVER_PRODUCTS_META,
  GULA,
  KOPI,
  TEH,
  UNDER,
  cards,
  loaded,
  withTheThreeLocks,
} from "./kit";

// DISCOVER PRODUCTS — the filters (discover-filters-in-a-side-panel): the panel beside the grid and its order, the one gap
// left marked (the division chips), Hide my products, the picked ranges, the lock filter, the category picker over the
// grid — and on a phone, the sheet. Gudang, Stok siap, Harga cross and Kategori narrow on the server, and the stub
// narrows as the server does, over the same figures the cards read (productStub `discoverStockSample`). The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProducts/Filters",
  ...DISCOVER_PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE FILTERS ARE A PANEL BESIDE THE GRID, Gudang first and Tim next (owner: *"gudang di atas, lalu tim"*,
 * discover-filters-in-a-side-panel) — then Kategori, Stok and Harga cross. */
export const TheFiltersAreBesideTheGrid: Story = {
  name: "Beside the grid",
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

/** ONLY THE DIVISION IS STILL MARKED — its chips (and its card badge) are listed in the strip at the top. Gudang, Kategori,
 * Stok siap, Harga cross and Kunci narrow on the server, so no group in the panel carries a mark. */
export const EveryGapIsMarked: Story = {
  name: "Gaps marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("discover-division")).getByTestId("not-implemented-division")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("discover-filter-panel")).queryByTestId(/^not-implemented-/)).toBeNull();
    for (const id of ["warehouse", "category", "stock", "crossRange", "lockFilter", "crossPrice", "cardStock"]) {
      await expect(canvas.queryByTestId(`not-implemented-${id}`)).toBeNull();
    }
  },
};

/** GUDANG KEEPS WHAT HOLDS READY UNITS THERE, AND THE CARDS READ THAT WAREHOUSE (discovers-warehouse-keeps-ready-stock-
 * there): picking Gudang Cabang leaves only what is on its shelves — never Kopi, held in Gudang Pusat alone — and a
 * product held in both now says Gudang Cabang's ready figure, not the total. The request and the cards' read carry the
 * warehouse; the URL keeps it. */
export const GudangNarrowsAndTheCardsReadIt: Story = {
  name: "Gudang narrows, cards read it",
  render: () => <AtDiscover />,
  parameters: { dataRouter: true },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const everywhere = discoverStockSample(UNDER.id, 0n).readyQty;
    const there = discoverStockSample(UNDER.id, CABANG).readyQty;
    const held = liveProducts().filter((p) => discoverStockSample(p.id, CABANG).readyQty > 0n);
    await expect(there).not.toBe(everywhere);
    await waitFor(() => expect(canvas.getByTestId(`discover-stock-ready-${UNDER.id}`)).toHaveTextContent(`${everywhere} pcs`));

    await pickTeam(canvas.getByTestId("discover-filter-warehouse"), "WH-02");

    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${held.length} product`));
    await expect(canvas.queryByTestId(`discover-card-${KOPI.productCode}`)).toBeNull();
    await waitFor(() => expect(canvas.getByTestId(`discover-stock-ready-${UNDER.id}`)).toHaveTextContent(`${there} pcs`));
    await expect(productDiscoverCalls.at(-1)!.warehouseId).toBe(CABANG);
    await expect(discoverStockCalls.at(-1)!.warehouseId).toBe(CABANG);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("warehouse=14"));
  },
};

/** STOK SIAP NARROWS TO ITS BAND, both ends included (discover-ranges-are-picked): 11–50 keeps exactly the products whose
 * ready stock is 11 to 50 and every card left says so; KOSONG keeps those with nothing ready — the never-stocked too;
 * the top band asks no upper edge. */
export const StokSiapNarrowsToItsBand: Story = {
  name: "Stok siap narrows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const stock = within(canvas.getByTestId("discover-stock-range"));
    const readyOf = (id: bigint) => discoverStockSample(id, 0n).readyQty;
    const inBand = liveProducts().filter((p) => readyOf(p.id) >= 11n && readyOf(p.id) <= 50n);
    await expect(inBand.length).toBeGreaterThan(0);

    await userEvent.click(stock.getByTestId("discover-stock-range-chips-11-50"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${inBand.length} product`));
    await expect(productDiscoverCalls.at(-1)!.ready).toEqual({ min: 11n, max: 50n });
    for (const c of cards(canvas)) {
      const figure = within(c).getByTestId(/^discover-stock-ready-/);
      await waitFor(() => expect(Number(figure.textContent!.replace(/\D/g, ""))).toBeGreaterThanOrEqual(11));
      await expect(Number(figure.textContent!.replace(/\D/g, ""))).toBeLessThanOrEqual(50);
    }

    const empty = liveProducts().filter((p) => readyOf(p.id) === 0n);
    await userEvent.click(stock.getByTestId("discover-stock-range-chips-0-0"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${empty.length} product`));
    await expect(productDiscoverCalls.at(-1)!.ready).toEqual({ min: 0n, max: 0n });

    await userEvent.click(stock.getByTestId("discover-stock-range-chips-10001-100000"));
    await waitFor(() => expect(productDiscoverCalls.at(-1)!.ready).toEqual({ min: 10001n, max: undefined }));
  },
};

/** HARGA CROSS KEEPS A RANGE THAT TOUCHES THE BAND (a-cross-band-keeps-a-range-that-touches-it): 10–25rb keeps Kopi
 * (Rp 20.350) and every product whose cross range overlaps it; a product with nothing priced (Gula) has no cross price
 * and leaves under any band; the top band asks no upper edge. */
export const HargaCrossKeepsWhatTouchesTheBand: Story = {
  name: "Harga cross narrows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const cross = within(canvas.getByTestId("discover-cross-range"));
    const touching = liveProducts().filter((p) => {
      const s = discoverStockSample(p.id, 0n);
      return s.crossKnown && s.crossMax >= 10_000 && s.crossMin <= 25_000;
    });
    await expect(touching.some((p) => p.id === KOPI.id)).toBe(true);

    await userEvent.click(cross.getByTestId("discover-cross-range-chips-10000-25000"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${touching.length} product`));
    await expect(canvas.getByTestId(`discover-card-${KOPI.productCode}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`discover-card-${GULA.productCode}`)).toBeNull();
    await expect(productDiscoverCalls.at(-1)!.crossPrice).toEqual({ min: 10_000, max: 25_000 });

    await userEvent.click(cross.getByTestId("discover-cross-range-chips-500000-1000000"));
    await waitFor(() => expect(productDiscoverCalls.at(-1)!.crossPrice).toEqual({ min: 500_000, max: undefined }));
  },
};

/** KATEGORI KEEPS THE PICKED BRANCH AND EVERYTHING BELOW IT (a-picked-branch-keeps-its-whole-subtree): with Teh filed under
 * Elektronik › Audio › Headphone, picking the branch Elektronik keeps Kopi (Elektronik) and Teh; picking the end category
 * Headphone keeps Teh alone. Any node may be picked. */
export const KategoriKeepsTheBranch: Story = {
  name: "Kategori keeps the branch",
  beforeEach: () => patchProduct(TEH.id, { categoryId: 53n }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const field = within(canvas.getByTestId("discover-filter-category"));

    await userEvent.click(field.getByTestId("category-select"));
    await userEvent.click(await canvas.findByTestId("category-node-Elektronik"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(/^2 products$/));
    await expect(canvas.getByTestId(`discover-card-${KOPI.productCode}`)).toBeInTheDocument();
    await expect(canvas.getByTestId(`discover-card-${TEH.productCode}`)).toBeInTheDocument();
    await expect(productDiscoverCalls.at(-1)!.categoryId).toBe(51n);

    await userEvent.click(field.getByTestId("category-select"));
    await userEvent.click(await canvas.findByTestId("category-drill-Elektronik"));
    await userEvent.click(await canvas.findByTestId("category-drill-Audio"));
    await userEvent.click(await canvas.findByTestId("category-node-Headphone"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(/^1 product$/));
    await expect(canvas.queryByTestId(`discover-card-${KOPI.productCode}`)).toBeNull();
    await expect(productDiscoverCalls.at(-1)!.categoryId).toBe(53n);
  },
};

// Built once, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const OpenedWithFilters = AtDiscoverWith("/products/discover?warehouse=14&stock=11-50&cross=custom&crossMin=1000&crossMax=50000");

/** THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url): a browse opened with them — Gudang Cabang, Stok siap
 * 11–50, Harga cross a range of one's own — asks the server with every one of them, and the panel shows them picked;
 * Hapus Filter takes them all back and the grid is whole again. */
export const TheUrlKeepsThemAndClearTakesThemBack: Story = {
  name: "URL keeps them, Clear takes them back",
  render: () => <OpenedWithFilters />,
  parameters: { dataRouter: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(productDiscoverCalls.at(-1)).toBeDefined(), { timeout: 4000 });
    await expect(productDiscoverCalls.at(-1)).toEqual(
      expect.objectContaining({
        warehouseId: CABANG,
        ready: { min: 11n, max: 50n },
        crossPrice: { min: 1000, max: 50_000 },
      }),
    );
    await expect(within(canvas.getByTestId("discover-stock-range")).getByTestId("discover-stock-range-chips-11-50")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByTestId("discover-cross-range-custom")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(await canvas.findByTestId("discover-filter-panel-clear"));
    await waitFor(() => expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${products.length}`));
    await expect(productDiscoverCalls.at(-1)).toEqual(
      expect.objectContaining({ warehouseId: 0n, categoryId: 0n, ready: undefined, crossPrice: undefined }),
    );
    await waitFor(() => expect(canvas.getByTestId("location-search").textContent).not.toContain("warehouse="));
  },
};

/** DISCOVER OPENS ON PRIORITAS (owner: *"secara default di tampilkan yang prioritas semua"*); another chip is a change
 * Hapus Filter takes back — to Prioritas, not to Semua. */
export const PriorityIsWhereItOpens: Story = {
  name: "Opens on Priority",
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

/** SEMBUNYIKAN PRODUK SAYA — only other teams' products; the team's own leaves the grid. A click on its WORDS ticks it —
 * not the team picker above it in the same group (owner: *"tidak bisa diklik malah ke selectnya"*). */
export const HideMineLeavesOtherTeams: Story = {
  name: "Hide mine",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId(`discover-card-${BERAS.productCode}`)).toBeInTheDocument();

    await userEvent.click(canvas.getByText("Hide my products"));

    await expect(within(canvas.getByTestId("discover-filter-hide-mine")).getByRole("checkbox")).toBeChecked();
    await expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${BERAS.productCode}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${KOPI.productCode}`)).toBeInTheDocument();
  },
};

/** THE RANGES ARE PICKED (owner: *"untuk stok dan price rangenya pilih saja, kalau mau custom kudu klik tombol dulu"*) —
 * a band is one click; the boxes for a range of one's own open only from Atur sendiri, and a typed stock is held under
 * 100.000. */
export const TheRangesArePicked: Story = {
  name: "Ranges picked",
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
 * in the panel, Semua first, unmarked; Hapus Filter takes a pick back. */
export const TheLockFilterIsOpenOrLocked: Story = {
  name: "Open or locked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const lock = within(canvas.getByTestId("discover-filter-lock"));

    await expect(lock.getByTestId("discover-lock-filter-")).toHaveAttribute("aria-pressed", "true");
    await expect(lock.queryByTestId("not-implemented-lockFilter")).toBeNull();
    await userEvent.click(lock.getByTestId("discover-lock-filter-locked"));
    await expect(lock.getByTestId("discover-lock-filter-locked")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(await canvas.findByTestId("discover-filter-panel-clear"));
    await waitFor(() => expect(lock.getByTestId("discover-lock-filter-")).toHaveAttribute("aria-pressed", "true"));
  },
};

/** KUNCI NARROWS THE GRID ON THE SERVER (discover-filters-by-lock, a-minimum-closes-only-under-it) — Terkunci keeps what
 * another team cannot take now: Teh, locked by its owner, and a minimum its every-warehouse total is under; never Kopi
 * (Min 2 under 40 ready) nor the one holding EXACTLY its minimum. Terbuka keeps every other. The count follows, the
 * request carries the pick, and every card left under Terkunci says it on its badge. */
export const KunciNarrowsTheGrid: Story = {
  name: "Kunci narrows",
  beforeEach: withTheThreeLocks,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const lock = within(canvas.getByTestId("discover-filter-lock"));
    const card = (code: string) => canvas.queryByTestId(`discover-card-${code}`);
    const closed = liveProducts().filter(
      (p) => p.crossLocked || (p.reservedStock > 0 && discoverStockSample(p.id, 0n).totalReadyQty < BigInt(p.reservedStock)),
    );

    await userEvent.click(lock.getByTestId("discover-lock-filter-locked"));
    await waitFor(() => expect(card(KOPI.productCode)).toBeNull());
    await expect(card(TEH.productCode)).toBeInTheDocument();
    await expect(card(UNDER.productCode)).toBeInTheDocument();
    await expect(card(AT.productCode)).toBeNull();
    await expect(canvas.getByTestId("discover-count")).toHaveTextContent(`${closed.length} product`);
    await expect(productDiscoverCalls.at(-1)).toEqual(
      expect.objectContaining({ lock: ProductLockFilter.CLOSED, includeLocked: true }),
    );
    // The filter and the badges agree: every card left says Locked.
    for (const c of cards(canvas)) {
      const badge = within(c).getByTestId(/^discover-lock-/);
      await waitFor(() => expect(badge.dataset.mode === "always" || badge.dataset.now === "true").toBe(true));
    }

    await userEvent.click(lock.getByTestId("discover-lock-filter-open"));
    await waitFor(() => expect(card(TEH.productCode)).toBeNull());
    await expect(card(UNDER.productCode)).toBeNull();
    await expect(card(KOPI.productCode)).toBeInTheDocument();
    await expect(card(AT.productCode)).toBeInTheDocument();
    await expect(productDiscoverCalls.at(-1)!.lock).toBe(ProductLockFilter.ORDERABLE);
  },
};

/** THE CATEGORY PICKER OPENS OVER THE GRID (owner: *"filter kategori ketutupan card produk"*) — its columns grow out of the
 * panel toward the cards, and stay on top of them: the panel is layered above the list beside it. */
export const TheCategoryPickerOpensOverTheGrid: Story = {
  name: "Category over the grid",
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

/** ON A PHONE THE SAME FILTERS ARE IN THE SHEET (a-phone-filters-from-a-sheet) — no panel; the search stays in the row,
 * and the Filter button opens every group, the sort last. */
export const APhoneFiltersFromTheSheet: Story = {
  name: "Phone · filter sheet",
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
