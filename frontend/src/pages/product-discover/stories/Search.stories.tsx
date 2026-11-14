import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { liveProducts } from "../../../../.storybook/productStub";
import { DiscoverProductsPage } from "../index";
import { DISCOVER_PRODUCTS_META, GULA, KOPI, TEH, cards, loaded } from "./kit";

// DISCOVER PRODUCTS — over the grid: the search by SKU and name, the sort, both held in the URL, and a search that
// finds nothing. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProducts/Search",
  ...DISCOVER_PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchesProductCodeAndName: Story = {
  name: "Product code and name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const search = canvas.getByTestId("discover-search");

    await userEvent.type(search, "gula");
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${KOPI.productCode}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${GULA.productCode}`)).toBeVisible();

    await userEvent.clear(search);
    await userEvent.type(search, TEH.productCode);
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${GULA.productCode}`)).toBeNull());
    await expect(canvas.getByTestId(`discover-card-${TEH.productCode}`)).toBeVisible();
  },
};

/** THE ORDER IS A SELECT over the grid — the newest first, or by name, A to Z. */
export const SortsByName: Story = {
  name: "Sort by name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-sort"));
    const byName = await canvas.findByRole("option", { name: "Name A–Z" });
    await waitFor(() => expect(byName).toBeVisible());
    await userEvent.click(byName);

    const first = [...liveProducts()].sort((a, b) => a.name.localeCompare(b.name))[0]!;
    await waitFor(() => expect(cards(canvas)[0]).toHaveAttribute("data-testid", `discover-card-${first.productCode}`));
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the browse is narrowed by it (the
// search and the owner team); a new search is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/products/discover", element: <><DiscoverProductsPage /><LocationProbe /></> }],
  `/products/discover?q=gula&team=${GULA.teamId}`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId(`discover-card-${GULA.productCode}`, {}, { timeout: 4000 });
    const search = canvas.getByTestId("discover-search");
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("gula");
    await expect(canvas.queryByTestId(`discover-card-${KOPI.productCode}`)).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "kopi", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("q=kopi"));
    // Kopi is the warehouse's, not team 13's — the team in the URL still narrows, so nothing matches.
    await canvas.findByTestId("discover-none-match", {}, { timeout: 4000 });
  },
};

// AN EMPTY BROWSE SAYS WHY, and offers to clear what narrowed it (an-empty-list-shows-a-hint).
export const NothingMatches: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("discover-search"), "zzz", { delay: 40 });

    const hint = await canvas.findByTestId("discover-none-match", {}, { timeout: 4000 });
    await expect(cards(canvas)).toHaveLength(0);

    await userEvent.click(within(hint).getByRole("button"));
    await canvas.findByTestId(`discover-card-${KOPI.productCode}`, {}, { timeout: 4000 });
  },
};
