import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, pickTeam, routedPage } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { SupplierGoodsGroup } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { supplierGoodsCalls, supplierListBandCalls } from "../../../../.storybook/supplierGoodsStub";
import { SuppliersPage } from "../index";
import { SUPPLIERS_META, BANYAK, SUMBER, loaded, rowIds } from "./kit";

// SUPPLIERS — the search, the store type and the warehouse in the filter strip, and the filters in the URL
// (a-lists-filters-live-in-the-url). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/Filters",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const CAHAYA = supplierFixture("CV Cahaya Abadi");

export const SearchesByName: Story = {
  name: "Search by name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("supplier-search"), "cahaya", { delay: 40 });

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${CAHAYA.id}`)).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the list is narrowed by it; a change
// is written back; Clear Filters writes them all away in one go (five filters, one navigation — none undoing another).
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/suppliers", element: <><SuppliersPage /><LocationProbe /></> }],
  `/inventories/suppliers?q=cahaya&type=${Marketplace.SHOPEE}`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("supplier-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("cahaya");
    await expect(canvas.getByTestId("marketplace-select")).toHaveTextContent("Shopee");

    await userEvent.click(await canvas.findByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(location).toBeEmptyDOMElement());
    await expect(search).toHaveValue("");

    await userEvent.type(search, "sumber", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("?q=sumber"));
  },
};

// THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold) — "which of ours sell on
// Lazada?": a live store of the type. Clear, red and bold while anything narrows, puts it back.
export const TheStoreTypeFilters: Story = {
  name: "Store type, then Clear",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("suppliers-filter-clear")).toBeNull();
    await userEvent.click(within(canvas.getByTestId("suppliers-type-filter")).getByTestId("marketplace-select"));
    const lazada = await canvas.findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toBeVisible();

    const clear = canvas.getByTestId("suppliers-filter-clear");
    await expect(getComputedStyle(clear).fontWeight).toBe("700");
    await userEvent.click(clear);
    await waitFor(() => expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toBeVisible());
  },
};

// THE WAREHOUSE IS THE FIRST PICKER (the-warehouse-filters-before-the-team) — right after the search, before the store
// type, where Discover's sits left of its team; real since 2026-11-14, so no mark beside it and no "not built yet" strip
// over the list. A warehouse team has no list, so no warehouse filter either.
export const TheWarehouseIsTheFirstPicker: Story = {
  name: "Warehouse first",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).queryByTestId("not-implemented-warehouse")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(
      canvas.getByTestId("suppliers-type-filter").getBoundingClientRect().left,
    );
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      canvas.getByTestId("supplier-search").getBoundingClientRect().right,
    );
  },
};

// THE GUDANG FILTER NARROWS ON THE SERVER (the-warehouse-filters-before-the-team) — Gudang Cabang keeps PT Sumber
// Makmur, whose goods were received there (and at Gudang Pusat); PT Banyak Toko, received only at Gudang Pusat, and the
// suppliers with no goods go. ONLY THE ROWS NARROW (the-warehouse-filter-narrows-only-the-rows): Sumber's Terjual and
// Siap read the same whole figures, every warehouse's, still asked per SUPPLIER. The pick lives in the URL; Clear Filters
// takes it away and the list is whole again.
const AtTheList = routedPage(
  [{ path: "/inventories/suppliers", element: <><SuppliersPage /><LocationProbe /></> }],
  "/inventories/suppliers",
);

export const TheWarehouseNarrowsTheRows: Story = {
  name: "Warehouse narrows the rows",
  parameters: { dataRouter: true },
  render: () => <AtTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toBeVisible();
    // The figures land after the rows — read them once they have (a dash until then).
    await waitFor(() => expect(canvas.getByTestId(`supplier-sold-${SUMBER.id}`).textContent).toMatch(/\d/));
    await waitFor(() => expect(canvas.getByTestId(`supplier-ready-${SUMBER.id}`).textContent).toMatch(/\d/));
    const sold = canvas.getByTestId(`supplier-sold-${SUMBER.id}`).textContent ?? "";
    const ready = canvas.getByTestId(`supplier-ready-${SUMBER.id}`).textContent ?? "";
    const cabang = teams.find((t) => t.id === 14n)!;

    await pickTeam(canvas.getByTestId("supplier-warehouse-filter"), cabang.teamCode);

    await waitFor(() => expect(rowIds(canvas)).toEqual([SUMBER.id.toString()]));
    await expect(supplierListBandCalls.at(-1)?.warehouseId).toBe(14n);
    await waitFor(() => expect(location).toHaveTextContent("?warehouse=14"));

    // The figures are the supplier's whole — the same cells, asked per supplier, never per warehouse.
    await expect(canvas.getByTestId(`supplier-sold-${SUMBER.id}`)).toHaveTextContent(sold);
    await expect(canvas.getByTestId(`supplier-ready-${SUMBER.id}`)).toHaveTextContent(ready);
    await expect(supplierGoodsCalls.at(-1)?.group).toBe(SupplierGoodsGroup.SUPPLIER);

    await userEvent.click(canvas.getByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toBeVisible());
    await expect(supplierListBandCalls.at(-1)?.warehouseId).toBe(0n);
    await waitFor(() => expect(location).toBeEmptyDOMElement());
  },
};

// OPENED AT A URL CARRYING THE WAREHOUSE (a-lists-filters-live-in-the-url) — a refresh, or Back from a supplier, opens the
// same narrowed list: Gudang Pusat keeps PT Sumber Makmur and PT Banyak Toko, its name alone in the picker.
const AtGudangPusat = routedPage(
  [{ path: "/inventories/suppliers", element: <><SuppliersPage /><LocationProbe /></> }],
  "/inventories/suppliers?warehouse=11",
);

export const TheWarehouseStaysInTheUrl: Story = {
  name: "Warehouse in the URL",
  parameters: { dataRouter: true },
  render: () => <AtGudangPusat />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rowIds(canvas)).toEqual([SUMBER.id.toString(), BANYAK.id.toString()].sort()));
    await expect(supplierListBandCalls.at(-1)?.warehouseId).toBe(11n);
    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(await within(warehouse).findByTestId("team-select-selected")).toHaveTextContent(/^Gudang Pusat$/);
    await expect(canvas.getByTestId("suppliers-filter-clear")).toBeVisible();
  },
};
