import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, pickTeam, routedPage } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";
import { supplierFixture, supplierFixtures } from "../../../../.storybook/supplierFixtures";
import { supplierGoodsCalls, supplierListBandCalls } from "../../../../.storybook/supplierGoodsStub";
import { SupplierGoodsGroup } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { DiscoverSuppliersPage } from "../index";
import { SUPPLIER_DISCOVER_META, LIVE, NUSANTARA, SUMBER, loaded, rows } from "./kit";

// DISCOVER SUPPLIERS — the warehouse, the team (discover-filters-team-before-store), the Sold and Ready ranges and
// the store-type chips (discover-shows-the-same-figures-and-filters) — their order, and on a phone the sheet. The
// page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers/Filters",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BANYAK = supplierFixture("PT Banyak Toko"); // team 12's — has a Lazada store

// "Whose suppliers?" — the Team filter keeps the suppliers one team keeps (discover-filters-by-the-team-that-keeps-it),
// sent to the server as the team's id.
export const FilterByTeam: Story = {
  name: "By team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const anggrek = teams.find((t) => t.id === 15n)!;

    await pickTeam(canvas.getByTestId("discover-suppliers-team-filter"), anggrek.teamCode);

    const kept = supplierFixtures.filter((s) => !s.deleted && s.teamId === anggrek.id);
    await waitFor(() => expect(rows(canvas)).toHaveLength(kept.length));
    for (const s of kept) {
      await expect(canvas.getByTestId(`discover-supplier-row-${s.id}`)).toBeVisible();
    }
  },
};

// "Who sells on Lazada?" — a supplier with at least one LIVE store of that type. PT Sumber Makmur's Lazada store
// was deleted, so it does not count (a-store-delete-is-soft-too).
export const FilterByChannelType: Story = {
  name: "By store type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The store type is a chip (a-store-type-filter-is-chips).
    await userEvent.click(canvas.getByRole("button", { name: "Lazada" }));
    await expect(canvas.getByRole("button", { name: "Lazada" })).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
    await expect(canvas.getByTestId(`discover-supplier-row-${BANYAK.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`discover-supplier-row-${SUMBER.id}`)).toBeNull();
  },
};

// The team filter comes before the store type.
export const TheTeamFilterComesFirst: Story = {
  name: "Team before store type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    // The store-type chips are the row under the filters.
    const type = canvas.getByTestId("discover-suppliers-type-filter").getBoundingClientRect();
    await expect(type.top).toBeGreaterThanOrEqual(team.bottom);
  },
};

// THE STORE TYPE IS CHIPS — Semua first and chosen, then every type; one pressed at a time; on a phone they stay out of
// the Filter sheet, one row that scrolls sideways (a-store-type-filter-is-chips).
export const TheStoreTypeIsChips: Story = {
  name: "Store type chips",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const chips = within(canvas.getByTestId("discover-suppliers-type-filter")).getAllByRole("button");

    await expect(chips.map((c) => c.textContent)).toEqual([
      "All",
      "Shopee",
      "Tokopedia",
      "Lazada",
      "TikTok",
      "Blibli",
      "Bukalapak",
      "Other",
    ]);
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");
  },
};

// THE WAREHOUSE FILTERS BEFORE THE TEAM (the-warehouse-filters-before-the-team) — right after the search, left of the
// team; real since 2026-11-14, so no mark beside it and no "not built yet" strip over the cards.
export const TheWarehouseFiltersBeforeTheTeam: Story = {
  name: "Warehouse before team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).queryByTestId("not-implemented-warehouse")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(within(warehouse).getByRole("combobox")).toHaveAttribute("placeholder", "All warehouses");
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    const search = canvas.getByTestId("discover-suppliers-search").getBoundingClientRect();
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(team.left);
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(search.right);
  },
};

// THE SAME RANGE FILTERS — Terjual and Siap after the team, a panel each, unmarked. A pick narrows the cards on the server
// (the-range-pills-are-a-fixed-set): Siap 100–250 is PT Sumber Makmur (151) and PT Banyak Toko (155); Clear takes it back.
export const TheFiguresFilterByRangePills: Story = {
  name: "Sold and Ready ranges",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(rows(canvas)).toHaveLength(Math.min(LIVE.length, 20)));
    const before = rows(canvas).length;

    await expect(within(canvas.getByTestId("supplier-range-sold")).queryByTestId("not-implemented-soldRange")).toBeNull();
    await expect(within(canvas.getByTestId("supplier-range-ready")).queryByTestId("not-implemented-readyRange")).toBeNull();
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    await expect(canvas.getByTestId("supplier-range-sold").getBoundingClientRect().left).toBeGreaterThan(team.left);

    await userEvent.click(canvas.getByTestId("supplier-range-ready-trigger"));
    const panel = await screen.findByTestId("supplier-range-ready-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByRole("button", { name: "100–250" }));
    await expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent("Ready: 100–250");
    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
    await expect(supplierListBandCalls.at(-1)?.ready).toEqual({ min: 100n, max: 250n });

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-clear"));
    await waitFor(() => expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent(/^Ready$/));
    await waitFor(() => expect(rows(canvas)).toHaveLength(before));
  },
};

// …and on a phone they stand in the Filter sheet, under the team.
export const APhoneFiltersByRangeInTheSheet: Story = {
  name: "Phone · in the sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-open"));
    const sheet = await screen.findByTestId("discover-suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("discover-suppliers-team-filter")).toBeVisible();
    // The warehouse first, then the team, as on a desktop.
    const warehouse = within(sheet).getByTestId("supplier-warehouse-filter").getBoundingClientRect();
    await expect(warehouse.bottom).toBeLessThanOrEqual(
      within(sheet).getByTestId("discover-suppliers-team-filter").getBoundingClientRect().top,
    );
    await expect(within(sheet).getByTestId("supplier-range-sold")).toBeVisible();
    await expect(within(sheet).getByTestId("supplier-range-ready")).toBeVisible();
  },
};

// THE GUDANG FILTER NARROWS THE CARDS ON THE SERVER (the-warehouse-filters-before-the-team) — every team's suppliers whose
// goods were received at Gudang Cabang: PT Sumber Makmur (Toko Melati's), UD Makmur Jaya (Toko Kenanga's) and PT Tekstil
// Nusantara (Toko Anggrek's). With Toko Kenanga picked too, only UD Makmur Jaya. ONLY THE ROWS NARROW
// (the-warehouse-filter-narrows-only-the-rows): Sumber's card reads the same whole Terjual and Siap. The pick lives in the
// URL; Clear Filters takes both away.
const AtDiscover = routedPage(
  [{ path: "/inventories/suppliers/discover", element: <><DiscoverSuppliersPage /><LocationProbe /></> }],
  "/inventories/suppliers/discover",
);

export const TheWarehouseNarrowsTheCards: Story = {
  name: "Warehouse narrows the cards",
  render: () => <AtDiscover />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    // The figures land after the cards — read them once they have.
    await waitFor(() => expect(canvas.getByTestId(`discover-card-figures-${SUMBER.id}`).textContent).toMatch(/\d/));
    const figures = canvas.getByTestId(`discover-card-figures-${SUMBER.id}`).textContent ?? "";
    const before = rows(canvas).length;
    const cabang = teams.find((t) => t.id === 14n)!;
    const kenanga = teams.find((t) => t.id === 13n)!;
    const atCabang = ["PT Sumber Makmur", "UD Makmur Jaya", "PT Tekstil Nusantara"].map((name) => supplierFixture(name).id);

    await pickTeam(canvas.getByTestId("supplier-warehouse-filter"), cabang.teamCode);

    await waitFor(() => expect(rows(canvas)).toHaveLength(atCabang.length));
    for (const id of atCabang) {
      await expect(canvas.getByTestId(`discover-supplier-row-${id}`)).toBeVisible();
    }
    await expect(supplierListBandCalls.at(-1)?.warehouseId).toBe(14n);
    await waitFor(() => expect(location).toHaveTextContent("warehouse=14"));
    // The figures are the supplier's whole — asked per supplier, never per warehouse.
    await expect(canvas.getByTestId(`discover-card-figures-${SUMBER.id}`)).toHaveTextContent(figures);
    await expect(supplierGoodsCalls.at(-1)?.group).toBe(SupplierGoodsGroup.SUPPLIER);

    await pickTeam(canvas.getByTestId("discover-suppliers-team-filter"), kenanga.teamCode);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));
    await expect(canvas.getByTestId(`discover-supplier-row-${supplierFixture("UD Makmur Jaya").id}`)).toBeVisible();

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-clear"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(before));
    await expect(supplierListBandCalls.at(-1)?.warehouseId).toBe(0n);
    await waitFor(() => expect(location).toBeEmptyDOMElement());
  },
};
