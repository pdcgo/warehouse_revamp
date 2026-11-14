import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { withProductState } from "../../../../.storybook/productScenario";
import { productListCalls } from "../../../../.storybook/productListScenario";
import { ProductLockFilter } from "../../../gen/warehouse/product/v1/product_pb";
import { At, PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the filter strip: the warehouse lens, the search, the lock and the stock's age (narrowed on the server), the
// empty hint, and the filters read back from the URL. The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Filters",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The warehouse lens restates every stock figure for that one building — the catalogue itself does not shrink. */
export const TheWarehouseLensRestatesTheStock: Story = {
  name: "Warehouse lens",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-001")).toHaveTextContent("79 pcs"));

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-001")).toHaveTextContent("25 pcs"));
    await expect(canvas.getByTestId("products-total-value")).toHaveTextContent(/^44$/);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("warehouse=14"));
  },
};

/** The search reads the name and the SKU, on the live tab. */
export const SearchesByNameOrProductCode: Story = {
  name: "Search, name or code",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "lada", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("product-row-SL-03-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SL-03-ANG-010")).toHaveTextContent("Lada Bubuk");
  },
};

/** A search that finds nothing says so, and its Hapus Filter is the strip's — one function, two buttons
 * (an-empty-list-shows-a-hint). */
export const NothingMatchesAndClears: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "zzz", { delay: 40 });
    const empty = await canvas.findByTestId("products-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No products found.");

    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-001")).toBeVisible());
    await expect(canvas.getByTestId("product-search")).toHaveValue("");
  },
};

// ── The lock and the stock's age (lock-and-stock-age-filter-ahead-of-the-contract) ─────────────────────────────────────
//
// Both are the SERVER's filters now — sent, and narrowed before the count and the page; the stub narrows as the server
// does (productStub.ts `inLockWay`, `agedAtLeast`) and records each request (productListScenario.ts). Toko Anggrek's
// lock, for these stories:
//
//   SL-03-ANG-001  Stok minimum 4     79 ready   — not under it
//   SL-03-ANG-002  Selalu dikunci     (keeps a minimum of 3 — Always wins)
//   SL-03-ANG-003  Stok minimum 1     nothing on a shelf — under any minimum, and no age
//   SL-03-ANG-004  Stok minimum 40    39 ready   — one under: Terkunci sekarang
//   SL-03-ANG-005  Terbuka
//   SL-03-ANG-006  Stok minimum 25    25 ready   — exactly at it: open (a-minimum-closes-only-under-it)

const LOCKS = [
  withProductState(701n, { crossLocked: true, reservedStock: 3 }),
  withProductState(702n, { reservedStock: 1 }),
  withProductState(703n, { reservedStock: 40 }),
  withProductState(705n, { reservedStock: 25 }),
];

const row = (canvas: ReturnType<typeof within>, n: string) => canvas.queryByTestId(`product-row-SL-03-ANG-${n}`);

/** The last request the TABLE sent — the headline's count asks ProductList for a single row beside it. */
const lastCall = () => productListCalls.filter((c) => c.limit > 1).at(-1)!;

async function pickLock(canvas: ReturnType<typeof within>, value: string) {
  await userEvent.click(canvas.getByTestId("product-lock-select"));
  const option = await canvas.findByTestId(`product-lock-select-option-${value}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function pickAge(canvas: ReturnType<typeof within>, days: string) {
  await userEvent.click(canvas.getByTestId("product-age-select"));
  const option = await canvas.findByTestId(`product-age-select-option-${days}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** Every row on screen reads an age of at least `days` — the Umur stok figure, desktop cell or phone block alike. */
function everyRowIsAtLeast(canvasElement: HTMLElement, days: number) {
  const rows = [...canvasElement.querySelectorAll('[data-testid^="product-row-"]')];
  for (const r of rows) {
    const age = /(\d+) days(?! ago)/.exec(r.textContent ?? "");
    expect(age, `${r.getAttribute("data-testid")} shows no age`).not.toBeNull();
    expect(Number(age![1]), `${r.getAttribute("data-testid")}`).toBeGreaterThanOrEqual(days);
  }
}

/** Each way of the lock narrows the list on the server — and *Terkunci sekarang* keeps only the minimums the ready stock is
 * UNDER: never one exactly at its minimum, and an empty shelf is under any. No ⚠ marks are left. */
export const TheLockNarrowsEachWay: Story = {
  name: "Lock, each way",
  beforeEach: LOCKS,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvasElement.querySelector('[data-testid^="not-implemented-"]')).toBeNull();

    await pickLock(canvas, "open");
    await waitFor(() => expect(row(canvas, "001")).toBeNull());
    await expect(row(canvas, "005")).toBeVisible();
    await expect(row(canvas, "002")).toBeNull();
    await expect(lastCall().lock).toBe(ProductLockFilter.MODE_OPEN);

    await pickLock(canvas, "min");
    await waitFor(() => expect(row(canvas, "005")).toBeNull());
    for (const n of ["001", "003", "004", "006"]) await expect(row(canvas, n)).toBeVisible();
    await expect(row(canvas, "002")).toBeNull();

    await pickLock(canvas, "always");
    await waitFor(() => expect(row(canvas, "002")).toBeVisible());
    await expect(row(canvas, "001")).toBeNull();

    await pickLock(canvas, "lockedNow");
    await waitFor(() => expect(row(canvas, "004")).toBeVisible());
    await expect(row(canvas, "003")).toBeVisible();
    await expect(row(canvas, "001")).toBeNull();
    await expect(row(canvas, "006")).toBeNull();
    await expect(row(canvas, "002")).toBeNull();
    await expect(lastCall().lock).toBe(ProductLockFilter.LOCKED_NOW);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("lock=lockedNow"));
  },
};

/** The stock's age narrows on the server: 30 days or more drops what has nothing on a shelf (no age), and every row left
 * reads at least the picked age — read in the warehouse lens when one is picked. */
export const TheAgeNarrows: Story = {
  name: "Stock age",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(row(canvas, "003")).toBeVisible();

    await pickAge(canvas, "30");
    await waitFor(() => expect(row(canvas, "003")).toBeNull());
    await expect(row(canvas, "001")).toBeVisible();
    await expect(lastCall().stockAgeMinDays).toBe(30);
    everyRowIsAtLeast(canvasElement, 30);

    await pickAge(canvas, "60");
    await waitFor(() => expect(lastCall().stockAgeMinDays).toBe(60));
    await waitFor(() => everyRowIsAtLeast(canvasElement, 60));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("age=60"));

    // The lens: the age is read in Gudang Cabang alone.
    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(lastCall().stockWarehouseId).toBe(14n));
    await expect(lastCall().stockAgeMinDays).toBe(60);
    await waitFor(() => everyRowIsAtLeast(canvasElement, 60));
  },
};

/** With nothing in force, *Terkunci sekarang* is an empty list that says so — and its Hapus Filter brings everything back. */
export const NothingLockedNowSaysSo: Story = {
  name: "Locked now, none",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickLock(canvas, "lockedNow");
    const empty = await canvas.findByTestId("products-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No products found.");

    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(row(canvas, "001")).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("lock="));
  },
};

/** Hapus Filter clears the lock and the age with the rest — the list sends neither again. */
export const ClearFiltersClearsTheLockAndTheAge: Story = {
  name: "Lock and age, cleared",
  beforeEach: LOCKS,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickLock(canvas, "lockedNow");
    await pickAge(canvas, "30");
    await waitFor(() => expect(row(canvas, "003")).toBeNull());
    await expect(row(canvas, "004")).toBeVisible();
    await expect(row(canvas, "001")).toBeNull();

    await userEvent.click(within(canvas.getByTestId("products-filter")).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(row(canvas, "001")).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("lock="));
    await expect(canvas.getByTestId("location-search")).not.toHaveTextContent("age=");
    await expect(lastCall().lock).toBe(ProductLockFilter.UNSPECIFIED);
    await expect(lastCall().stockAgeMinDays).toBe(0);
  },
};

/** Opened at a URL holding a lock and an age, the list is narrowed by both, and the two pickers show them
 * (a-lists-filters-live-in-the-url). */
const AtLockedAndAged = At("/products?lock=lockedNow&age=30");
export const TheLockAndAgeComeBackFromTheUrl: Story = {
  name: "Lock and age from the URL",
  beforeEach: LOCKS,
  render: () => <AtLockedAndAged />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("product-row-SL-03-ANG-004", {}, { timeout: 5000 })).toBeVisible();
    await expect(row(canvas, "003")).toBeNull(); // locked now, but nothing on a shelf has an age
    await expect(row(canvas, "001")).toBeNull();
    await expect(canvas.getByTestId("product-lock-select")).toHaveTextContent("Locked now");
    await expect(canvas.getByTestId("product-age-select")).toHaveTextContent("30 days or more");
    await expect(lastCall()).toMatchObject({ lock: ProductLockFilter.LOCKED_NOW, stockAgeMinDays: 30 });
  },
};

/** Opened at a URL holding a search, the list is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/products?q=lada");
export const TheSearchComesBackFromTheUrl: Story = {
  name: "Search from the URL",
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("product-search", {}, { timeout: 5000 })).toHaveValue("lada");
    await waitFor(() => expect(canvas.getByTestId("product-row-SL-03-ANG-010")).toBeVisible());
    await expect(canvas.queryByTestId("product-row-SL-03-ANG-001")).toBeNull();
  },
};
