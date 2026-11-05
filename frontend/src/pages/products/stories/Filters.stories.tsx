import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { At, PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the filter strip: the warehouse lens, the search, the lock and age filters held ahead of the contract, the
// empty hint, and a search read back from the URL. The page's stories are grouped by the part of the screen they are
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
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("79 pcs"));

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("25 pcs"));
    await expect(canvas.getByTestId("products-total-value")).toHaveTextContent(/^44$/);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("warehouse=14"));
  },
};

/** The search reads the name and the SKU, on the live tab. */
export const SearchesByNameOrSku: Story = {
  name: "Search, name or SKU",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "lada", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-010")).toHaveTextContent("Lada Bubuk");
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
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toBeVisible());
    await expect(canvas.getByTestId("product-search")).toHaveValue("");
  },
};

/** THE LOCK AND THE STOCK'S AGE, AHEAD OF THE CONTRACT — each a filter held in the URL and marked ⚠, its pick thrown away:
 * every product still shows (PRODUCTS_LIST_PENDING). Hapus Filter clears them with the rest. */
export const LockAndAgeFiltersAreHeldAndMarked: Story = {
  name: "Lock and age, marked",
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

/** Opened at a URL holding a search, the list is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/products?q=lada");
export const TheSearchComesBackFromTheUrl: Story = {
  name: "Search from the URL",
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("product-search", {}, { timeout: 5000 })).toHaveValue("lada");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-010")).toBeVisible());
    await expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull();
  },
};
