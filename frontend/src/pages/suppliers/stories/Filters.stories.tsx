import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { SuppliersPage } from "../index";
import { SUPPLIERS_META, BANYAK, SUMBER, loaded } from "./kit";

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
// type, where Discover's sits left of its team; its mark (1) beside it, not wired yet. A warehouse team has no list, so
// no warehouse filter either.
export const TheWarehouseIsTheFirstPicker: Story = {
  name: "Warehouse first",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).getByTestId("not-implemented-warehouse")).toHaveTextContent("1");
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(
      canvas.getByTestId("suppliers-type-filter").getBoundingClientRect().left,
    );
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      canvas.getByTestId("supplier-search").getBoundingClientRect().right,
    );
  },
};
