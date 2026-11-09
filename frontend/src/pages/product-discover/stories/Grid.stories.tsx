import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { asPlatformOnly } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { DISCOVER_PRODUCTS_META, KOPI, cards, loaded } from "./kit";

// DISCOVER PRODUCTS — the grid: paging through the catalogue, a new search back on page 1, a bigger page holding it all
// — and nobody's team to browse for. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProducts/Grid",
  ...DISCOVER_PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const PAGE_SIZE = 20;

// Positional on purpose: the stub pages the fixture array in order, so these ARE the page boundaries.
const PAGE_2_FIRST = products[PAGE_SIZE]!;
const LAST = products[products.length - 1]!;
const LAST_PAGE_COUNT = products.length % PAGE_SIZE || PAGE_SIZE;

// Someone in no team at all has no scope to authorize the read, so the page asks for one instead of
// firing a request the server would refuse.
export const NoTeamSelected: Story = {
  name: "No team",
  beforeEach: asPlatformOnly(Role.WAREHOUSE_ADMIN, []),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("discover-no-team", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("discover-grid")).toBeNull();
  },
};

export const PagesThroughTheCatalogue: Story = {
  name: "Pages through",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.productCode}`, {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.queryByTestId(`discover-card-${KOPI.productCode}`)).toBeNull());
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    // The short last page.
    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${LAST.productCode}`, {}, { timeout: 4000 });
    await waitFor(() => expect(cards(canvas)).toHaveLength(LAST_PAGE_COUNT));
  },
};

// A new search starts again from page 1. Left on page 3, "kopi" — three matches, one page — would ask
// for a page that does not exist and read as "No products found".
export const SearchStartsAgainFromPageOne: Story = {
  name: "Search, back to page 1",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.productCode}`, {}, { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("discover-pager-next"));
    await canvas.findByTestId(`discover-card-${LAST.productCode}`, {}, { timeout: 4000 });

    await userEvent.type(canvas.getByTestId("discover-search"), "kopi", { delay: 40 });

    await canvas.findByTestId(`discover-card-${KOPI.productCode}`, {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("discover-none-match")).toBeNull();
  },
};

// A bigger page holds the whole catalogue.
export const FiftyPerPageHoldsTheCatalogue: Story = {
  name: "Fifty per page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-pager-size"));
    const fifty = await canvas.findByRole("option", { name: "50" });
    await waitFor(() => expect(fifty).toBeVisible());
    await userEvent.click(fifty);

    await waitFor(() => expect(cards(canvas)).toHaveLength(products.length));
  },
};
