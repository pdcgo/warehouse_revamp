import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { pickTeam } from "../../../../.storybook/pageStory";
import { discoverHistoryCalls, productDailyCalls, productSupplierCalls } from "../../../../.storybook/productListScenario";
import {
  AtBeras,
  BERAS,
  DISCOVER_PRODUCT_DETAIL_META,
  EMPTY,
  GULA,
  STOCKED,
  loaded,
  openPendingStrip,
  openTab,
  sectionOf,
  stockLoaded,
} from "./kit";

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
// usually another team's), the store it was bought at beside it. Real rows (ProductSupplierGoods), unmarked.
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

// ANOTHER TEAM'S PRODUCT'S SUPPLIERS ARE REAL, and its cost never comes (the-supplier-tab-names-the-store): Toko Melati
// (12) reads Kenanga's Gula — UD Makmur Jaya's Shopee store, the one delivery of its stock history's story into Gudang
// Pusat (22 pcs: the 12 on the shelf and the 10 that went out). The owner's columns less Modal terakhir, no rupiah
// anywhere in the tab, and no ⚠ on it or in the strip.
export const AnotherTeamsSuppliersShowNoCost: Story = {
  name: "Another team's suppliers, no cost",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    await expect(within(canvas.getByTestId("dd-tab-suppliers")).queryByTestId("not-implemented-suppliers")).toBeNull();

    const suppliers = await openTab(canvas, "suppliers");
    const table = await suppliers.findByTestId("pd-suppliers-table");
    await waitFor(() => expect(suppliers.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(1));
    await expect(productSupplierCalls.at(-1)).toEqual({ teamId: 12n, productId: GULA.id, warehouseId: 0n, page: 1 });

    await expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Supplier",
      "Supplier store",
      "Deliveries",
      "Units",
      "Last delivery",
    ]);
    await waitFor(() => expect(suppliers.getByTestId("supplier-open-34")).toHaveTextContent("UD Makmur Jaya"));
    await expect(suppliers.getByTestId("pd-supplier-deliveries-0")).toHaveTextContent("1");
    await expect(suppliers.getByTestId("pd-supplier-units-0")).toHaveTextContent("22 pcs");
    await expect(table).not.toHaveTextContent("Rp");

    await openPendingStrip(canvas);
    await expect(canvas.queryByTestId("pending-row-suppliers")).toBeNull();
  },
};

// THE SUPPLIERS FOLLOW THE PICKER, as on the owner's page: Gudang Cabang received no delivery of Gula, so its lens reads
// the empty hint — asked of the server with that warehouse, not cut on the screen.
export const TheSuppliersFollowThePicker: Story = {
  name: "Suppliers, in the lens",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");
    await waitFor(() => expect(suppliers.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(1));

    await pickTeam(canvas.getByTestId("dd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(productSupplierCalls.at(-1)?.warehouseId).toBe(EMPTY.id));
    await waitFor(() => expect(suppliers.getByTestId("pd-suppliers-empty")).toBeVisible());
    await expect(suppliers.getByTestId("pd-suppliers-empty")).toHaveTextContent("Try another warehouse");
  },
};

// THE TEAM'S OWN PRODUCT shows no cost here either: the server sends Beras's last cost to Toko Melati, its owner, but the
// discover detail never draws a cost — that is the product's own page's column.
export const YourOwnProductsSuppliersShowNoCostHere: Story = {
  name: "Your own product's suppliers, no cost",
  render: () => <AtBeras />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await openTab(canvas, "suppliers");

    await waitFor(() => expect(suppliers.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(1));
    await expect(productSupplierCalls.at(-1)).toEqual({ teamId: 12n, productId: BERAS.id, warehouseId: 0n, page: 1 });
    await expect(suppliers.queryByTestId("pd-supplier-cost-0")).toBeNull();
    await expect(suppliers.getByTestId("pd-suppliers-table")).not.toHaveTextContent("Rp");
  },
};

// RIWAYAT STOK IS EVERYONE'S (stock-history-is-everyones) — another team's product shows its REAL ledger, read by
// DiscoverStockHistory: Gula's deliveries in and orders out of Gudang Pusat, its newest movement leaving exactly what is
// ready there. Unmarked now. No Batch column (the-discover-history-names-no-batch) and no money of the owner's.
export const AnotherTeamsHistoryIsShown: Story = {
  name: "Another team's history",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);

    await expect(within(canvas.getByTestId("dd-tab-history")).queryByTestId("not-implemented-history")).toBeNull();
    const history = await openTab(canvas, "history");
    await history.findByTestId("dd-history");
    const table = await history.findByTestId("pd-history-table");
    await waitFor(() => expect(within(table).getAllByRole("row").slice(1).length).toBe(5));
    const rows = within(table).getAllByRole("row").slice(1);

    // The read the page asked: Toko Melati (12) about Kenanga's Gula, every warehouse, page 1.
    await expect(discoverHistoryCalls.at(-1)).toEqual({ teamId: 12n, productId: GULA.id, warehouseId: 0n, page: 1 });

    const headings = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headings).toContain("Warehouse");
    await expect(headings).not.toContain("Batch");
    await expect(rows[0]).toHaveTextContent(`${warehouseStock[GULA.id.toString()]}`);
    await expect(table).not.toHaveTextContent("Rp");

    // …and the page's ⚠ strip no longer lists it.
    await openPendingStrip(canvas);
    await expect(canvas.queryByTestId("pending-row-history")).toBeNull();
  },
};

// THE HISTORY FOLLOWS THE PICKER, as the owner's page's does: Gudang Cabang never held Gula, so its lens reads the empty
// hint — asked of the server with that warehouse, not cut on the screen.
export const AnotherTeamsHistoryFollowsThePicker: Story = {
  name: "Another team's history, in the lens",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const history = await openTab(canvas, "history");
    await history.findByTestId("pd-history-table");

    await pickTeam(canvas.getByTestId("dd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(discoverHistoryCalls.at(-1)?.warehouseId).toBe(EMPTY.id));
    await waitFor(() => expect(history.getByTestId("pd-history-empty")).toBeVisible());
  },
};

// THE TEAM'S OWN PRODUCT keeps the owner's ledger (OwnerStockHistory), as its own page reads it — the discover read is
// never asked for it.
export const YourOwnHistoryIsTheOwnersLedger: Story = {
  name: "Your own product's history",
  render: () => <AtBeras />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const history = await openTab(canvas, "history");

    await waitFor(() => expect(history.getByTestId("pd-history-empty")).toBeVisible());
    await expect(history.queryByTestId("dd-history")).toBeNull();
    await expect(discoverHistoryCalls).toHaveLength(0);
  },
};

type DailyFigures = { in: number; out: number; onHand: number };

/** One tab row's figures, today first — "+3 pcs" / "−2 pcs" / "12 pcs" / "—" (0). */
function dailyOf(tab: { getAllByTestId: (id: RegExp) => HTMLElement[]; getByTestId: (id: string) => HTMLElement }): DailyFigures[] {
  const figure = (el: HTMLElement) => Number((el.textContent ?? "").replace(/[^\d]/g, "") || "0");
  return tab.getAllByTestId(/^pd-daily-row-\d+$/).map((_: HTMLElement, i: number) => ({
    in: figure(tab.getByTestId(`pd-daily-in-${i}`)),
    out: figure(tab.getByTestId(`pd-daily-out-${i}`)),
    onHand: figure(tab.getByTestId(`pd-daily-balance-${i}`)),
  }));
}

// ANOTHER TEAM'S DAYS ARE REAL (the-discover-detail-has-the-warehouse-zone, stock-history-is-everyones): Toko Melati (12)
// reads Kenanga's Gula — the last fourteen days of its stock history's story into Gudang Pusat, four orders out on four
// days, today's Sisa its 12 on the shelf, every day adding up. Units only: no rupiah in the tab, no ⚠ on it or in the
// strip.
export const AnotherTeamsDaysAreReal: Story = {
  name: "Another team's days",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    await expect(within(canvas.getByTestId("dd-tab-daily")).queryByTestId("not-implemented-daily")).toBeNull();

    const daily = await openTab(canvas, "daily");
    await waitFor(() => expect(daily.getAllByTestId(/^pd-daily-row-\d+$/)).toHaveLength(14));
    await expect(productDailyCalls.at(-1)).toEqual({ teamId: 12n, productId: GULA.id, warehouseId: 0n });

    const days = dailyOf(daily);
    await expect(days[0]!.onHand).toBe(Number(warehouseStock[GULA.id.toString()]));
    await expect(days.map((d: DailyFigures, i: number) => (d.out > 0 ? i : -1)).filter((i: number) => i >= 0)).toEqual([1, 4, 8, 12]);
    for (let i = days.length - 2; i >= 0; i--) {
      await expect(days[i + 1]!.onHand + days[i]!.in - days[i]!.out).toBe(days[i]!.onHand);
    }
    await expect(daily.getByTestId("pd-daily-table")).not.toHaveTextContent("Rp");

    await openPendingStrip(canvas);
    await expect(canvas.queryByTestId("pending-row-daily")).toBeNull();
  },
};

// THE DAYS FOLLOW THE PICKER, as on the owner's page: Gudang Cabang never held Gula — fourteen days of nothing, asked of
// the server with that warehouse.
export const AnotherTeamsDaysFollowThePicker: Story = {
  name: "Another team's days, in the lens",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const daily = await openTab(canvas, "daily");
    await waitFor(() => expect(daily.getByTestId("pd-daily-balance-0")).toHaveTextContent(`${warehouseStock[GULA.id.toString()]} pcs`));

    await pickTeam(canvas.getByTestId("dd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(productDailyCalls.at(-1)?.warehouseId).toBe(EMPTY.id));
    await waitFor(() => expect(daily.getByTestId("pd-daily-balance-0")).toHaveTextContent("0 pcs"));
    await expect(dailyOf(daily).every((d: DailyFigures) => d.in === 0 && d.out === 0 && d.onHand === 0)).toBe(true);
  },
};
