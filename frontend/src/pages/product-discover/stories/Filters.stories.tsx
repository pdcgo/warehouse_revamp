import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { BERAS, DISCOVER_PRODUCTS_META, KOPI, loaded } from "./kit";

// DISCOVER PRODUCTS — the filters (discover-filters-in-a-side-panel): the panel beside the grid and its order, the gaps
// marked, the division chips opening on Prioritas, Hide my products, the picked ranges, the lock filter, the category
// picker over the grid — and on a phone, the sheet. The page's stories are grouped by the part of the screen they are
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

/** WHAT CANNOT BE ANSWERED YET IS MARKED where it is — the warehouse, the category, the stock and the price range, the
 * division chips, and another team's cross price — and listed in the strip at the top. */
export const EveryGapIsMarked: Story = {
  name: "Gaps marked",
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
 * in the panel, Semua first; a pick narrows nothing yet, so the group carries its ⚠, and Hapus Filter takes it back. */
export const TheLockFilterIsOpenOrLocked: Story = {
  name: "Open or locked",
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
