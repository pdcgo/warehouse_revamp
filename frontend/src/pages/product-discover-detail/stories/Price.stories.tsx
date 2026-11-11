import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { ownerStockSample, shelfSample } from "../../../../.storybook/productStub";
import { formatRupiahRange } from "../../../lib/money";
import { DISCOVER_PRODUCT_DETAIL_META, EMPTY, GULA, STOCKED, routedAt, sectionOf, stockLoaded } from "./kit";

// DISCOVER PRODUCT DETAIL — Harga per Gudang: a row for every warehouse, even an empty one, each with its price — and
// your own product priced from its own batches. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Price",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// WHERE: every warehouse gets a row, including the one holding nothing — out of stock there is the
// answer worth seeing, not a row to hide. Nothing on its shelf, so nothing priced there.
export const EveryWarehouseHasARow: Story = {
  name: "Every warehouse a row",
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
  name: "Each its price",
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

// TEAM 15'S CATALOGUE carries batches in BOTH warehouses at different costs (productStub.ts) — the own product whose
// prices differ per warehouse.
const FIGURED_TEAM = 15n;
const MINYAK_ID = 700n;
const AtMinyak = routedAt(MINYAK_ID);

// THE TEAM'S OWN PRODUCT, PRICED PER WAREHOUSE FROM ITS OWN BATCHES — team 15's Minyak came in at different costs in its
// two warehouses, so each row says its own: the cross price, and the cost under it. Real figures, so unmarked.
export const YourOwnProductPricesEachWarehouse: Story = {
  name: "Own product, own costs",
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
