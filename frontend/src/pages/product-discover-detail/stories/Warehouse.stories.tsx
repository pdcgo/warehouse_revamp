import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { pickTeam } from "../../../../.storybook/pageStory";
import { DISCOVER_PRODUCT_DETAIL_META, GULA, STOCKED, loaded, openTab, sectionOf, stockLoaded } from "./kit";

// DISCOVER PRODUCT DETAIL — Per Gudang, the owner's page's warehouse card without Harga Modal
// (the-discover-detail-has-the-warehouse-zone): the overview under the picker, the suppliers and their stores, the stock
// history. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Warehouse",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSE CARD'S OVERVIEW — the lens's small figures: Siap, Dikirim and the CROSS PRICE RANGE, no stock age
// (the-overview-says-the-cross-range). Gula's 12 ready at Info's cross price in every warehouse; none, and no price, once
// Gudang Cabang is picked. Harga per Gudang above the card does not move with the picker.
export const TheOverviewFollowsThePicker: Story = {
  name: "Overview follows the picker",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const warehouse = await sectionOf(canvas, "warehouse");
    const shelf = warehouseStock[GULA.id.toString()]!;

    await waitFor(() => expect(warehouse.getByTestId("dd-overview-ready")).toHaveTextContent(`${shelf} pcs`));
    await expect(warehouse.getByTestId("dd-overview-cross")).toHaveTextContent(canvas.getByTestId("discover-detail-cross").textContent!);
    await expect(warehouse.queryByTestId("dd-overview-row-age")).toBeNull();
    await expect(warehouse.queryByTestId("dd-overview-row-cost")).toBeNull();

    await pickTeam(canvas.getByTestId("dd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(warehouse.getByTestId("dd-overview-ready")).toHaveTextContent("0 pcs"));
    await expect(warehouse.getByTestId("dd-overview-cross")).toHaveTextContent("—");
    await expect(warehouse.getByTestId("pd-warehouse-note")).toBeVisible();
    // The price section is every warehouse, still.
    await expect(canvas.getByTestId(`discover-stock-row-${STOCKED.id}`)).toBeInTheDocument();
  },
};

// WHO SELLS IT — a tab of Per Gudang, as on the owner's page: each supplier opening the supplier DISCOVER detail (it is
// usually another team's), the store it was bought at beside it. ⚠ Sample rows (pending "suppliers").
export const SuppliersOpenTheSupplierDiscoverDetail: Story = {
  name: "Suppliers open their page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");

    await waitFor(() => expect(suppliers.getAllByTestId(/^pd-supplier-row-\d+$/).length).toBeGreaterThan(0));
    await userEvent.click(suppliers.getAllByTestId(/^supplier-open-/)[0]!);
    await canvas.findByTestId("at-supplier");
  },
};

// THE SUPPLIER'S STORE (the-supplier-tab-names-the-store): its name, the marketplace UNDER it, and — when it has a link —
// the name opens the store in a new tab. No cost on this page: the last cost is the owner's.
export const TheSupplierStoreOpensItsLink: Story = {
  name: "Store link",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");

    const link = await waitFor(() => suppliers.getAllByTestId(/^supplier-store-link-/)[0]!);
    await expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(suppliers.queryByTestId("pd-supplier-cost-0")).toBeNull();
    await expect(suppliers.queryByText("Last cost")).toBeNull();
  },
};

// RIWAYAT STOK IS EVERYONE'S (stock-history-is-everyones) — another team's product shows the ledger, its rows a sample
// (marked) that ends at the real shelf: Gula's newest Gudang Pusat movement leaves exactly what is ready there.
export const AnotherTeamsHistoryIsShown: Story = {
  name: "Another team's history",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);

    await expect(within(canvas.getByTestId("dd-tab-history")).getByTestId("not-implemented-history")).toBeInTheDocument();
    const history = await openTab(canvas, "history");
    const table = await history.findByTestId("pd-history-table");
    const rows = within(table).getAllByRole("row").slice(1);

    await expect(rows.length).toBe(5);
    // No Batch column here (the-discover-history-names-no-batch) — the warehouse names each movement's building.
    const headings = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    await expect(headings).toContain('Warehouse');
    await expect(headings).not.toContain('Batch');
    await expect(rows[0]).toHaveTextContent(`${warehouseStock[GULA.id.toString()]}`);
  },
};
