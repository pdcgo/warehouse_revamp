import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverProductsPage } from "./index";

// The cross-team browse (#106): every team's products, as a grid of cards, each naming its owner.
//
// The stub's ProductDiscover ignores `team_id` exactly as the server does — the current team is the
// authorizing scope, never a filter — so all 48 fixture products are on offer: four named ones across
// three teams, then team 15's big catalogue. At the page's default of 20 that is pages of 20, 20 and 8.

const SELLING_TEAM = 12n;
const PAGE_SIZE = 20;

const byName = (name: string) => products.find((p) => p.name === name)!;
const teamName = (teamId: bigint) => teams.find((t) => t.id === teamId)!.name;

const KOPI = byName("Kopi Arabika 250g"); // the warehouse's (11)
const TEH = byName("Teh Melati 100g");
const GULA = byName("Gula Pasir 1kg"); // the priority team's (13)
const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's — the team standing here

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

export const Default: Story = {};

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

export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("discover-search"), "zzz", { delay: 40 });

    await canvas.findByTestId("discover-empty", {}, { timeout: 4000 });
    await expect(cards(canvas)).toHaveLength(0);
  },
};

export const PagesThroughTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    await userEvent.click(canvas.getByTestId("page-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.sku}`, {}, { timeout: 4000 });
    await expect(canvas.queryByTestId(`discover-card-${KOPI.sku}`)).toBeNull();
    await expect(cards(canvas)).toHaveLength(PAGE_SIZE);

    // The short last page.
    await userEvent.click(canvas.getByTestId("page-next"));
    await canvas.findByTestId(`discover-card-${LAST.sku}`, {}, { timeout: 4000 });
    await expect(cards(canvas)).toHaveLength(LAST_PAGE_COUNT);
  },
};

// A new search starts again from page 1. Left on page 3, "kopi" — three matches, one page — would ask
// for a page that does not exist and read as "No products found".
export const SearchStartsAgainFromPageOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("page-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.sku}`, {}, { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("page-next"));
    await canvas.findByTestId(`discover-card-${LAST.sku}`, {}, { timeout: 4000 });

    await userEvent.type(canvas.getByTestId("discover-search"), "kopi", { delay: 40 });

    await canvas.findByTestId(`discover-card-${KOPI.sku}`, {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("discover-empty")).toBeNull();
  },
};

// A bigger page holds the whole catalogue, asked from page 2. The page resets to 1 here as it does on a
// search, but this story cannot prove that alone — the pager also pulls an out-of-range page back on
// its own — so what it pins is that the size change lands, not which of the two did the reset.
export const FiftyPerPageHoldsTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("page-next"));
    await canvas.findByTestId(`discover-card-${PAGE_2_FIRST.sku}`, {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("page-size"));
    const fifty = await canvas.findByRole("option", { name: "50" });
    await waitFor(() => expect(fifty).toBeVisible());
    await userEvent.click(fifty);

    await canvas.findByTestId(`discover-card-${KOPI.sku}`, {}, { timeout: 4000 });
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
