import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { discoverStockSample, ownerStockSample, shelfSample } from "../../../../.storybook/productStub";
import { formatRupiahRange } from "../../../lib/money";
import { AtKopi, DISCOVER_PRODUCT_DETAIL_META, EMPTY, GULA, KOPI, STOCKED, routedAt, sectionOf, stockLoaded } from "./kit";

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

// AT WHAT PRICE, per warehouse: another team's is the card's read in THAT warehouse (DiscoverStockByIds) — Kopi is held in
// Gudang Pusat alone, so that row's price is the whole range Info says; real, unmarked.
export const EachWarehouseHasItsPrice: Story = {
  name: "Each its price",
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const price = await sectionOf(canvas, "price");
    const there = discoverStockSample(KOPI.id, STOCKED.id);

    await waitFor(() =>
      expect(price.getByTestId(`discover-stock-cross-${STOCKED.id}`)).toHaveTextContent(
        formatRupiahRange(there.crossMin, there.crossMax),
      ),
    );
    await expect(price.getByTestId(`discover-stock-cross-${STOCKED.id}`)).toHaveTextContent(
      canvas.getByTestId("discover-detail-cross").textContent!,
    );
    await expect(price.queryByTestId("not-implemented-crossPrice")).toBeNull();
    // Another team's cost is never shown.
    await expect(price.queryByTestId(`discover-stock-cost-${STOCKED.id}`)).toBeNull();
  },
};

// ANOTHER TEAM'S PRODUCT HELD IN TWO WAREHOUSES AT DIFFERENT COSTS (team 15's Minyak, read by Toko Melati): each row says
// its own warehouse's cross price — the card's read in that warehouse — and the Overview's lens follows the picker with the
// same figures. Never a cost.
export const AnotherTeamsPriceIsEachWarehouses: Story = {
  name: "Another team's, each warehouse its price",
  // Read by Toko Melati, the meta's team — another team's product.
  render: () => <AtMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const price = await sectionOf(canvas, "price");

    for (const w of [STOCKED, EMPTY]) {
      const there = discoverStockSample(MINYAK_ID, w.id);
      await expect(there.crossKnown).toBe(true);
      await waitFor(() =>
        expect(price.getByTestId(`discover-stock-cross-${w.id}`)).toHaveTextContent(formatRupiahRange(there.crossMin, there.crossMax)),
      );
      await expect(price.queryByTestId(`discover-stock-cost-${w.id}`)).toBeNull();
    }
    await expect(price.getByTestId(`discover-stock-cross-${STOCKED.id}`).textContent).not.toBe(
      price.getByTestId(`discover-stock-cross-${EMPTY.id}`).textContent,
    );
    await expect(canvas.queryByTestId("not-implemented-crossPrice")).toBeNull();
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
