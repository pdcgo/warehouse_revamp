import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";
import { supplierFixture, supplierFixtures } from "../../../../.storybook/supplierFixtures";
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
// team, its mark (5) beside it: not wired yet.
export const TheWarehouseFiltersBeforeTheTeam: Story = {
  name: "Warehouse before team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).getByTestId("not-implemented-warehouse")).toHaveTextContent("5");
    await expect(within(warehouse).getByRole("combobox")).toHaveAttribute("placeholder", "All warehouses");
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    const search = canvas.getByTestId("discover-suppliers-search").getBoundingClientRect();
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(team.left);
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(search.right);
  },
};

// THE SAME RANGE FILTERS — Terjual and Siap after the team, a panel each, marked 3 and 4. A pick is held, the trigger
// reads the band, and the cards do not move for it; Clear takes it back.
export const TheFiguresFilterByRangePills: Story = {
  name: "Sold and Ready ranges",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(rows(canvas)).toHaveLength(Math.min(LIVE.length, 20)));
    const before = rows(canvas).length;

    await expect(within(canvas.getByTestId("supplier-range-sold")).getByTestId("not-implemented-soldRange")).toHaveTextContent("3");
    await expect(within(canvas.getByTestId("supplier-range-ready")).getByTestId("not-implemented-readyRange")).toHaveTextContent("4");
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    await expect(canvas.getByTestId("supplier-range-sold").getBoundingClientRect().left).toBeGreaterThan(team.left);

    await userEvent.click(canvas.getByTestId("supplier-range-ready-trigger"));
    const panel = await screen.findByTestId("supplier-range-ready-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByRole("button", { name: "100–250" }));
    await expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent("Ready: 100–250");
    await expect(rows(canvas)).toHaveLength(before);

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-clear"));
    await waitFor(() => expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent(/^Ready$/));
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
