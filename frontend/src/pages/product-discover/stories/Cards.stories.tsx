import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../../../.storybook/fixtures";
import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { liveProducts, ownerStockSample } from "../../../../.storybook/productStub";
import { readyStatus } from "../../../features/products/stockAge";
import { withMarkup } from "../../../lib/markup";
import { formatRupiahRange } from "../../../lib/money";
import { DiscoverProductsPage } from "../index";
import { sampleDivision, sampleStock } from "../../../features/products/discoverSample";
import { BERAS, DISCOVER_PRODUCTS_META, GULA, KOPI, SELLING_TEAM, TEH, loaded, withALockedProduct } from "./kit";

// DISCOVER PRODUCTS — a card: whose product it is, the cross price (and your own product's cost), the division and the
// lock on its cover, its stock running low — and where it opens. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProducts/Cards",
  ...DISCOVER_PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const FIGURED_TEAM = 15n; // the stub's catalogue WITH costs — the team whose own products show real figures
const teamName = (teamId: bigint) => teams.find((t) => t.id === teamId)!.name;
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

/** BOTH LOCKS ARE ON THE GRID — Selalu dikunci on Teh Melati, Min 2 pcs on Kopi — in the design the owner asked for. */
export const TheLocksAreOnTheGrid: Story = {
  name: "Both locks",
  beforeEach: withALockedProduct,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`discover-lock-${TEH.id}`)).toHaveAttribute("data-mode", "always");
    await expect(canvas.getByTestId(`discover-lock-${KOPI.id}`)).toHaveTextContent("Min 2 pcs");
    await expect(canvas.queryByTestId(`discover-lock-${GULA.id}`)).toBeNull();
  },
};

// Discovery is ACROSS teams, and each card says whose product it is — on a cross-team page that is the
// thing worth knowing. The team standing here is not filtered out either: its own product is on offer
// beside everyone else's.
export const EveryTeamsProductsNamedByOwner: Story = {
  name: "Named by owner",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const product of [KOPI, GULA, BERAS]) {
      const card = canvas.getByTestId(`discover-card-${product.sku}`);
      // The names land after the products (one TeamByIds per page), so the card first reads "Team #<id>".
      await waitFor(() => expect(card).toHaveTextContent(teamName(product.teamId)));
    }
  },
};

/** ANOTHER TEAM'S CARD SAYS THE CROSS PRICE, and only that (discover-shows-the-cross-price) — what a borrower pays. Its
 * cost cannot be read across teams yet, so the figure carries its ⚠. NO LABEL BESIDE IT (owner: *"harga apa tidak perlu
 * diberi label tooltips saja"*, a-discover-price-is-red-and-unlabelled): the figure alone, in red, and a hover says what it
 * is. */
export const AnotherTeamsCardSaysTheCrossPrice: Story = {
  name: "Another team's cross price",
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
  name: "Own product, cost and cross",
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

/** THE DIVISION AND THE LOCK RIDE ON THE COVER (owner: *"keterangannya kurang terlihat, kasih di atas sendiri"*) — and
 * UMUM CARRIES NO BADGE (*"di card tidak perlu badge untuk yang umum"*): the ordinary case; Prioritas keeps its own. */
export const TheBadgesAreOnTheCover: Story = {
  name: "Badges on the cover",
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
  name: "Low stock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`discover-stock-ready-${LOW_STOCK.id}`)).toHaveAttribute("data-status", "low");
    await expect(canvas.getByTestId(`discover-stock-ready-${OUT_OF_STOCK.id}`)).toHaveAttribute("data-status", "out");
    await expect(canvas.getByTestId(`discover-stock-ready-${HEALTHY.id}`)).toHaveAttribute("data-status", "ok");
  },
};

// Only the click-through story mounts this: the rest need no router of their own.
const Routed = routedPage(
  [
    { path: "/products/discover", element: <DiscoverProductsPage /> },
    marker("/products/discover/:productId", "at-discover-detail"),
  ],
  "/products/discover",
);

// A card opens the DISCOVER detail — never the owner's /products/:id, which answers only the owning team
// and would read every other team's product as not found.
export const ACardOpensTheDiscoverDetail: Story = {
  name: "Opens the detail",
  parameters: { dataRouter: true },
  render: () => <Routed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`discover-open-${GULA.sku}`));
    await canvas.findByTestId("at-discover-detail");
  },
};
